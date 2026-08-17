#!/usr/bin/env python3
import base64, json, os, re, ssl, sys, time, urllib.request, urllib.error, urllib.parse
from html.parser import HTMLParser
from ftplib import FTP_TLS, error_perm

UA = "Mozilla/5.0 (compatible; SEORepairAudit/1.0; +https://github.com/grouppro365-ux/pcs-legat-avatar-pipeline)"

class SEOParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_title=False; self.title=[]
        self.in_h1=False; self.h1_buf=[]; self.h1s=[]
        self.meta={}; self.canonical=None; self.lang=None
        self.jsonld=[]; self._script_type=None; self._script_buf=[]
    def handle_starttag(self, tag, attrs):
        d={k.lower(): (v or "") for k,v in attrs}
        tag=tag.lower()
        if tag=="html": self.lang=d.get("lang") or self.lang
        elif tag=="title": self.in_title=True
        elif tag=="h1": self.in_h1=True; self.h1_buf=[]
        elif tag=="meta":
            key=(d.get("name") or d.get("property") or "").lower()
            if key: self.meta[key]=d.get("content","").strip()
        elif tag=="link" and "canonical" in (d.get("rel","").lower().split()):
            self.canonical=d.get("href","").strip()
        elif tag=="script":
            self._script_type=(d.get("type") or "").lower()
            self._script_buf=[]
    def handle_endtag(self, tag):
        tag=tag.lower()
        if tag=="title": self.in_title=False
        elif tag=="h1":
            self.in_h1=False
            txt=" ".join("".join(self.h1_buf).split())
            if txt: self.h1s.append(txt)
            self.h1_buf=[]
        elif tag=="script":
            if self._script_type=="application/ld+json":
                raw="".join(self._script_buf).strip()
                if raw: self.jsonld.append(raw[:20000])
            self._script_type=None; self._script_buf=[]
    def handle_data(self, data):
        if self.in_title: self.title.append(data)
        if self.in_h1: self.h1_buf.append(data)
        if self._script_type=="application/ld+json": self._script_buf.append(data)
    def result(self):
        types=[]
        for raw in self.jsonld:
            try:
                obj=json.loads(raw)
                stack=[obj]
                while stack:
                    x=stack.pop()
                    if isinstance(x,dict):
                        t=x.get("@type")
                        if isinstance(t,str): types.append(t)
                        elif isinstance(t,list): types.extend([str(i) for i in t])
                        stack.extend(x.values())
                    elif isinstance(x,list): stack.extend(x)
            except Exception:
                pass
        return {
            "title":" ".join("".join(self.title).split()),
            "description":self.meta.get("description"),
            "robots":self.meta.get("robots"),
            "googlebot":self.meta.get("googlebot"),
            "canonical":self.canonical,
            "lang":self.lang,
            "h1s":self.h1s,
            "jsonld_types":sorted(set(types)),
        }

def request(url, method="GET", body=None, headers=None, auth=None, timeout=25):
    h={"User-Agent":UA, "Accept":"*/*"}
    if headers: h.update(headers)
    if auth:
        token=base64.b64encode((auth[0]+":"+auth[1]).encode()).decode()
        h["Authorization"]="Basic "+token
    data=None
    if body is not None:
        if isinstance(body,(dict,list)):
            data=json.dumps(body,ensure_ascii=False).encode()
            h.setdefault("Content-Type","application/json")
        elif isinstance(body,str):
            data=body.encode()
        else: data=body
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    started=time.time()
    try:
        with urllib.request.urlopen(req,timeout=timeout,context=ssl.create_default_context()) as r:
            raw=r.read(3_000_000)
            return {"ok":True,"status":r.status,"url":r.geturl(),"headers":dict(r.headers),
                    "body":raw.decode("utf-8","replace"),"elapsed_ms":round((time.time()-started)*1000)}
    except urllib.error.HTTPError as e:
        raw=e.read(1_000_000)
        return {"ok":False,"status":e.code,"url":getattr(e,"url",url),
                "headers":dict(e.headers or {}),"body":raw.decode("utf-8","replace"),
                "error":f"HTTP {e.code}","elapsed_ms":round((time.time()-started)*1000)}
    except Exception as e:
        return {"ok":False,"status":None,"url":url,"error":type(e).__name__+": "+str(e)[:300],
                "elapsed_ms":round((time.time()-started)*1000)}

def html_audit(url):
    r=request(url)
    out={k:r.get(k) for k in ("ok","status","url","elapsed_ms","error") if k in r}
    if r.get("body"):
        p=SEOParser()
        try: p.feed(r["body"])
        except Exception: pass
        out.update(p.result())
    return out

def json_get(url, auth=None):
    r=request(url,auth=auth,headers={"Accept":"application/json"})
    val=None
    if r.get("body"):
        try: val=json.loads(r["body"])
        except Exception: pass
    return r,val

def sitemap_audit(base):
    r=request(base+"/sitemap_index.xml")
    locs=[]
    if r.get("body"):
        locs=re.findall(r"<loc>\s*([^<]+?)\s*</loc>",r["body"],flags=re.I)
    return {"status":r.get("status"),"url":r.get("url"),"elapsed_ms":r.get("elapsed_ms"),
            "locs":locs[:30],"count":len(locs),"error":r.get("error")}

def robots_audit(base):
    r=request(base+"/robots.txt")
    body=r.get("body","")
    sitemaps=re.findall(r"(?im)^\s*Sitemap:\s*(\S+)",body)
    return {"status":r.get("status"),"url":r.get("url"),"body":body[:20000],
            "sitemaps":sitemaps,"elapsed_ms":r.get("elapsed_ms"),"error":r.get("error")}

def variant_audit(domain):
    urls=[f"http://{domain}/",f"https://{domain}/",f"http://www.{domain}/",f"https://www.{domain}/"]
    out=[]
    for u in urls:
        r=request(u,timeout=15)
        out.append({"input":u,"status":r.get("status"),"final":r.get("url"),
                    "ok":r.get("ok"),"error":r.get("error"),"elapsed_ms":r.get("elapsed_ms")})
    return out

def ftp_connect(cfg):
    errs=[]
    for host in cfg.get("hosts",[]):
        try:
            ftp=FTP_TLS(timeout=25)
            ftp.connect(host,21)
            ftp.auth()
            ftp.login(cfg["user"],cfg["password"])
            ftp.prot_p()
            ftp.set_pasv(True)
            ftp.sendcmd("TYPE I")
            return ftp,host,errs
        except Exception as e:
            errs.append({"host":host,"error":type(e).__name__+": "+str(e)[:200]})
            try: ftp.close()
            except Exception: pass
    return None,None,errs

def ftp_exists(ftp,path):
    try:
        ftp.size(path)
        return True
    except Exception:
        try:
            parent,name=path.rsplit("/",1)
            return name in [x.rsplit("/",1)[-1] for x in ftp.nlst(parent)]
        except Exception:
            return False

def find_wp_path(ftp,domain):
    candidates=[
        f"/{domain}/public_html", f"{domain}/public_html",
        f"/{domain}", domain,
        f"/public_html/{domain}", f"public_html/{domain}",
    ]
    for p in candidates:
        p=p.rstrip("/")
        if ftp_exists(ftp,p+"/wp-load.php") and ftp_exists(ftp,p+"/wp-config.php"):
            return p
    try:
        roots=ftp.nlst("/")
    except Exception:
        try: roots=ftp.nlst()
        except Exception: roots=[]
    needle=domain.lower().replace("www.","")
    for root in roots[:250]:
        name=root.rstrip("/").rsplit("/",1)[-1].lower()
        if needle in name or name in needle:
            for p in (root.rstrip("/")+"/public_html",root.rstrip("/")):
                if ftp_exists(ftp,p+"/wp-load.php") and ftp_exists(ftp,p+"/wp-config.php"):
                    return p
    return None

def audit_site(site, ftp=None):
    domain=site["domain"]; base="https://"+domain
    result={"domain":domain,"expected":{"title":site.get("title"),"description":site.get("description"),
                                      "focus":site.get("focus")}}
    result["variants"]=variant_audit(domain)
    result["homepage"]=html_audit(base+"/")
    result["robots"]=robots_audit(base)
    result["sitemap"]=sitemap_audit(base)
    rr, root=json_get(base+"/wp-json/")
    if isinstance(root,dict):
        result["wp"]={"status":rr.get("status"),"name":root.get("name"),"description":root.get("description"),
                      "home":root.get("home"),"url":root.get("url"),"show_on_front":root.get("show_on_front"),
                      "page_on_front":root.get("page_on_front"),"page_for_posts":root.get("page_for_posts"),
                      "rankmath_namespace":any(str(n).startswith("rankmath/") for n in root.get("namespaces",[]))}
    else:
        result["wp"]={"status":rr.get("status"),"error":rr.get("error")}
    app=site.get("app_password")
    if app:
        app=app.replace(" ","")
        ar,me=json_get(base+"/wp-json/wp/v2/users/me?context=edit",auth=(site.get("wp_user","adminnp"),app))
        result["wp_auth"]={"status":ar.get("status"),"ok":ar.get("status")==200,
                           "user_id":me.get("id") if isinstance(me,dict) else None,
                           "error":ar.get("error")}
    else:
        result["wp_auth"]={"status":None,"ok":False,"reason":"no_application_password_in_registry"}
    pr,posts=json_get(base+"/wp-json/wp/v2/posts?per_page=1&orderby=date&order=desc&_fields=link,date,modified,status")
    if isinstance(posts,list) and posts:
        result["sample_post_ref"]=posts[0]
        if posts[0].get("link"): result["sample_post"]=html_audit(posts[0]["link"])
    cr,cats=json_get(base+"/wp-json/wp/v2/categories?per_page=5&hide_empty=true&_fields=link,name,count")
    if isinstance(cats,list) and cats:
        result["sample_category_ref"]=cats[0]
        if cats[0].get("link"): result["sample_category"]=html_audit(cats[0]["link"])
    if ftp:
        result["ftp_wp_path"]=find_wp_path(ftp,domain)
    return result

def main():
    payload_path=os.environ.get("SEO_PAYLOAD","/tmp/payload.json")
    with open(payload_path,"r",encoding="utf-8") as f: cfg=json.load(f)
    report={"mode":"audit","started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
            "sites":[],"ftp":{}}
    ftp=None
    if cfg.get("beget"):
        ftp,host,errs=ftp_connect(cfg["beget"])
        report["ftp"]={"connected":bool(ftp),"host":host,"attempt_errors":errs}
        if ftp:
            try:
                roots=ftp.nlst("/")
                report["ftp"]["root_entries"]=[x.rsplit("/",1)[-1] for x in roots[:300]]
            except Exception as e:
                report["ftp"]["root_list_error"]=type(e).__name__+": "+str(e)[:200]
    for site in cfg.get("sites",[]):
        try:
            report["sites"].append(audit_site(site,ftp))
        except Exception as e:
            report["sites"].append({"domain":site.get("domain"),"fatal":type(e).__name__+": "+str(e)[:500]})
    if ftp:
        try: ftp.quit()
        except Exception: pass
    report["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
    out=os.environ.get("SEO_RESULT","/tmp/result.json")
    with open(out,"w",encoding="utf-8") as f: json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps({"ok":True,"sites":len(report["sites"]),"ftp_connected":report["ftp"].get("connected")},ensure_ascii=False))

if __name__=="__main__":
    main()
