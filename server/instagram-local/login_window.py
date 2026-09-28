"""Explicit local sign-in and one-shot read. Never sends Direct messages."""
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import queue
import sys
import threading

from intake import EncryptedStore, Intake, IntakeError, new_state, protect, read_only_client, unprotect

# Upstream exceptions may include response bodies. Never log or display them.
logging.disable(logging.CRITICAL)


class LocalSession:
    def __init__(self, store):
        self.store = store
        self.state = store.load()
        self.client = None
        self.authenticated = False

    def login(self, username, password, code=""):
        username = username.strip().lstrip("@").lower()
        if not username or not password:
            raise IntakeError("credentials_required")
        if self.state and self.state["username"] != username:
            raise IntakeError("account_mismatch")
        if self.client is None:
            self.client = read_only_client()
            if self.state and self.state.get("session"):
                self.client.set_settings(self.state["session"])
        self.authenticated = False
        try:
            if not self.client.login(username, password, verification_code=code.strip()):
                raise IntakeError("login_failed")
            account = self.client.account_info()
            if str(account.pk) != str(self.client.user_id):
                raise IntakeError("account_mismatch")
            state = self.state or new_state(str(account.pk), username)
            if state["account_id"] != str(account.pk):
                raise IntakeError("account_mismatch")
            state = dict(state, session=self.client.get_settings())
            self.store.save(state)
            self.state = state
            self.authenticated = True
            return "Вход выполнен. С этого момента можно проверить новые входящие. Ответы выключены."
        finally:
            # Credentials are used only by the local process for this login.
            self.client.password = ""

    def read_once(self):
        if not self.authenticated:
            raise IntakeError("login_required")
        try:
            updated = Intake(self.client).collect(self.state)
            added = len(updated["events"]) - len(self.state["events"])
            updated["session"] = self.client.get_settings()
            self.store.save(updated)
            self.state = updated
            return f"Новых сообщений сохранено локально: {added}. Всего: {len(updated['events'])}. На сервер не переданы; ответов не отправлено."
        except Exception:
            self.authenticated = False
            raise


def safe_error(error):
    messages = {
        "credentials_required": "Введите логин и пароль Instagram в этом окне.",
        "account_mismatch": "Обнаружен другой аккаунт. Работа остановлена; существующая сессия сохранена.",
        "login_required": "Сначала выполните вход. После ошибки автоматический повтор отключён.",
        "instagram_security_check": "Instagram запросил проверку безопасности. Завершите её вручную в Instagram; автоматического обхода нет.",
        "thread_limit_manual_review": "Слишком много диалогов для безопасной проверки. Данные не изменены; нужна доработка постраничного чтения.",
        "history_gap_manual_review": "История получена не полностью. Данные не изменены; нужна проверка оператором.",
        "local_queue_full": "Локальная очередь заполнена. Передача в PCS ещё не подключена.",
    }
    if isinstance(error, IntakeError):
        return messages.get(str(error), "Проверка остановлена. Локальные данные не заменены.")
    name = type(error).__name__
    if name == "TwoFactorRequired":
        return "Нужен код двухфакторной защиты. Введите пароль и свежий код в поля этого окна, затем нажмите вход."
    if name in {"BadPassword", "BadCredentials"}:
        return "Instagram не принял данные входа. Проверьте логин и пароль самостоятельно."
    if name in {"PleaseWaitFewMinutes", "RateLimitError", "FeedbackRequired"}:
        return "Instagram ограничил запросы. Проверка остановлена; не повторяйте вход сейчас."
    return "Не удалось завершить проверку. Работа остановлена. Секреты и ответ Instagram не выводятся."


def main():
    if "--self-check" in sys.argv:
        import tkinter
        assert unprotect(protect(b"pcs-synthetic-check")) == b"pcs-synthetic-check"
        assert read_only_client().__class__.__name__ == "LocalReadOnlyClient"
        print(json.dumps({"instagrapi": importlib.metadata.version("instagrapi"),
                          "tk": tkinter.Tcl().eval("info patchlevel"),
                          "dpapi": "ok", "mode": "local_read_only"}))
        return
    import msvcrt
    import tkinter as tk
    from tkinter import ttk, messagebox

    directory = Path(os.environ["LOCALAPPDATA"]) / "PCS" / "instagram-local"
    directory.mkdir(parents=True, exist_ok=True)
    root = tk.Tk()
    root.title("PCS · Подключение Instagram — проверка входа")
    root.geometry("620x500")
    root.minsize(570, 470)
    lock = open(directory / "instance.lock", "a+b")
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        session = LocalSession(EncryptedStore(directory / "account.dpapi"))
    except Exception:
        messagebox.showerror("PCS", "Окно уже открыто либо зашифрованная сессия недоступна. Данные не сброшены.")
        root.destroy()
        lock.close()
        return

    frame = ttk.Frame(root, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Instagram: проверка подключения", font=("Segoe UI", 16, "bold")).pack(anchor="w")
    ttk.Label(frame, text="Без Meta Developers. Неофициальная библиотека: Instagram может\nограничить вход. Этот этап только читает новые сообщения по кнопке.\nПароль не сохраняется; сессия зашифрована Windows.\nИИ и автоматические ответы пока НЕ подключены.",
              justify="left").pack(anchor="w", pady=(10, 15))
    fields = []
    for label, masked in [("Логин Instagram", False), ("Пароль", True), ("Код 2FA, если требуется", True)]:
        ttk.Label(frame, text=label).pack(anchor="w")
        entry = ttk.Entry(frame, show="•" if masked else "", width=60)
        entry.pack(fill="x", pady=(3, 8))
        fields.append(entry)
    if session.state:
        fields[0].insert(0, session.state["username"])
    status = tk.StringVar(value="Введите данные только здесь. Не отправляйте пароль в чат.")
    results = queue.Queue()
    busy = False

    def submit(login=False):
        nonlocal busy
        if busy:
            return
        values = [field.get() for field in fields] if login else []
        fields[1].delete(0, "end")
        fields[2].delete(0, "end")
        busy = True
        login_button.config(state="disabled")
        read_button.config(state="disabled")
        status.set("Проверяю… Сообщения клиентам не отправляются.")

        def work():
            try:
                results.put(session.login(*values) if login else session.read_once())
            except Exception as error:
                results.put(safe_error(error))
            finally:
                values.clear()
        threading.Thread(target=work, daemon=True).start()

    def check_result():
        nonlocal busy
        try:
            status.set(results.get_nowait())
            busy = False
            login_button.config(state="normal")
            read_button.config(state="normal" if session.authenticated else "disabled")
        except queue.Empty:
            pass
        root.after(200, check_result)

    login_button = ttk.Button(frame, text="Войти в Instagram", command=lambda: submit(True))
    login_button.pack(fill="x", pady=(7, 5))
    read_button = ttk.Button(frame, text="Проверить новые входящие — без ответов", command=submit, state="disabled")
    read_button.pack(fill="x")
    ttk.Label(frame, textvariable=status, wraplength=560, justify="left").pack(anchor="w", pady=12)
    root.after(200, check_result)
    root.mainloop()
    lock.close()


if __name__ == "__main__":
    main()
