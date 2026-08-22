import './globals.css';
import Link from 'next/link';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ru"><body><div className="shell"><nav className="nav"><div className="brand">Premium Concierge Service Thailand</div><Link href="/">Inbox</Link><Link href="/approvals">Требуют ответа</Link><Link href="/dashboard">Dashboard</Link><Link href="/knowledge">База знаний</Link><Link href="/settings">Настройки</Link></nav><main className="main">{children}</main></div></body></html>}
