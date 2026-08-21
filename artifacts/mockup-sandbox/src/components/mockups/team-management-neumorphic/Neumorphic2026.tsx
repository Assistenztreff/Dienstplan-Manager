import { useState } from "react";
import {
  BarChart3, Building2, CalendarDays, CalendarOff, ChevronDown, ChevronRight,
  Download, Edit3, LayoutDashboard, LogOut, Mail, MoreHorizontal, Plus,
  Send, Settings, ShieldCheck, Trash2, UserCog, UserPlus, Users,
} from "lucide-react";
import "./_group.css";

type Person = { initials: string; name: string; email: string; status: string; lead?: boolean; color: string; hours?: string; days?: string; vacation?: string; since?: string; note?: string };
const teams: { name: string; people: Person[] }[] = [
  { name: "Team Nord", people: [
    { initials:"LH", name:"Lena Hoffmann", email:"lena.hoffmann@beispiel.de", status:"Aktiv", lead:true, color:"", hours:"30 h", days:"4 Tage", vacation:"24 Tage", since:"01.03.2023", note:"Feste Nachtdienste am Wochenende." },
    { initials:"JW", name:"Jonas Weber", email:"jonas.weber@beispiel.de", status:"Aktiv", color:"gold", hours:"20 h", days:"3 Tage", vacation:"20 Tage", since:"15.09.2023" },
    { initials:"AY", name:"Aylin Yıldız", email:"aylin.yildiz@beispiel.de", status:"Inaktiv", color:"rose" },
  ]},
  { name: "Team Süd", people: [
    { initials:"MN", name:"Marek Novak", email:"marek.novak@beispiel.de", status:"Aktiv", color:"gold", hours:"38,5 h", days:"5 Tage", vacation:"28 Tage", since:"01.01.2022" },
    { initials:"SB", name:"Sophie Bauer", email:"sophie.bauer@beispiel.de", status:"Aktiv", color:"", },
  ]},
];
const nav = [{label:"Dashboard",icon:LayoutDashboard},{label:"Dienstplan",icon:CalendarDays},{label:"Assistenten",icon:Users},{label:"Abwesenheiten",icon:CalendarOff},{label:"Auswertungen",icon:BarChart3},{label:"Einstellungen",icon:Settings}];

function PersonCard({ person, notify }: { person: Person; notify: (message:string)=>void }) {
  return <article className="tm-person">
    <div className="tm-person-head"><span className={`tm-avatar ${person.color}`}>{person.initials}</span><div><div className="tm-name">{person.name}</div><div className="tm-contact">{person.email}</div></div></div>
    <div className="tm-badges"><span className={`tm-badge ${person.status === "Inaktiv" ? "off" : ""}`}>{person.status}</span>{person.lead && <span className="tm-badge lead"><ShieldCheck size={11}/>Teamleiter</span>}</div>
    {person.hours ? <div className="tm-facts"><div className="tm-fact"><span>Wochenstunden</span><b>{person.hours}</b></div><div className="tm-fact"><span>Arbeitstage/Woche</span><b>{person.days}</b></div><div className="tm-fact"><span>Urlaubsanspruch</span><b>{person.vacation}</b></div><div className="tm-fact"><span>Im Team seit</span><b>{person.since}</b></div>{person.note && <div className="tm-note">{person.note}</div>}</div> : <div className="tm-note">Arbeitszeiten sind noch nicht hinterlegt. Du kannst sie beim Bearbeiten ergänzen.</div>}
    <div className="tm-person-actions"><button aria-label={`${person.name} bearbeiten`} className="tm-icon-btn" onClick={()=>notify(`Personalakte von ${person.name} öffnen`)}><Edit3 size={16}/></button><button aria-label={`Einladung für ${person.name} senden`} className="tm-icon-btn" onClick={()=>notify(`Einladung für ${person.name} vorbereitet`)}><Send size={16}/></button><button aria-label={`Nachweis für ${person.name} laden`} className="tm-icon-btn" onClick={()=>notify("Stundennachweis wird erstellt")}><Download size={16}/></button></div>
  </article>;
}

export function Neumorphic2026() {
  const [open, setOpen] = useState<Record<string,boolean>>({"Team Nord":true,"Team Süd":true});
  const [coordinator, setCoordinator] = useState([true,true,false]);
  const [notice, setNotice] = useState("");
  const notify = (message:string) => { setNotice(message); window.setTimeout(()=>setNotice(""), 2200); };
  return <div className="team-mgmt-neu">
    <header className="tm-topbar"><div className="tm-shell"><a href="#" className="tm-brand"><span className="tm-brand-mark">A</span>AssistenzPlaner</a><nav className="tm-links" aria-label="Plattform"><button>Über uns</button><button>Handbuch</button><button>Leistungen</button></nav><div className="tm-utility"><button className="profile">Mein Profil</button><button aria-label="Abmelden"><LogOut size={16}/><span className="sr-only">Abmelden</span></button></div></div></header>
    <nav className="tm-appnav" aria-label="Dienstplan-App"><div className="tm-shell">{nav.map(({label,icon:Icon})=><button key={label} className={label==="Einstellungen"?"active":""}><Icon size={16}/>{label}</button>)}</div></nav>
    <main className="tm-main"><div className="tm-shell">
      <section className="tm-pagehead"><div><div className="tm-eyebrow">Einstellungen / Organisation</div><h1>Team-Verwaltung</h1><p>Teams, Assistenzkräfte und Zugänge an einem klaren Ort verwalten.</p></div><button className="tm-primary" onClick={()=>notify("Neues Team anlegen")}><Plus size={17}/>Neues Team</button></section>
      <div className="tm-workspace"><section className="tm-stack" aria-label="Teams">
        {teams.map(team=><section className="tm-team" key={team.name}><header className="tm-teamhead"><button className="tm-team-title" onClick={()=>setOpen(o=>({...o,[team.name]:!o[team.name]}))} aria-expanded={open[team.name]}>{open[team.name]?<ChevronDown size={18}/>:<ChevronRight size={18}/>}<Building2 size={17}/>{team.name}<span>· {team.people.length} Assistenzkräfte</span></button><div className="tm-team-actions"><button className="tm-button" onClick={()=>notify("Team-Zugriffsrechte öffnen")}><UserCog size={15}/>Zugriffsrechte</button><button className="tm-button quiet" aria-label={`${team.name} bearbeiten`} onClick={()=>notify(`${team.name} bearbeiten`)}><Edit3 size={16}/></button><button className="tm-button quiet" aria-label={`${team.name} weitere Aktionen`} onClick={()=>notify("Weitere Team-Aktionen")}><MoreHorizontal size={17}/></button></div></header>
          {open[team.name] && <div className="tm-teambody"><div className="tm-teammeta"><span><strong>{team.people.length}</strong> {team.people.length===1?"Assistenzkraft":"Assistenzkräfte"}</span><button className="tm-button" onClick={()=>notify(`Assistenzkraft für ${team.name} anlegen`)}><UserPlus size={15}/>Assistenzkraft anlegen</button></div><div className="tm-people">{team.people.map(person=><PersonCard key={person.email} person={person} notify={notify}/>)}</div></div>}
        </section>)}
      </section>
      <aside className="tm-side"><h2>Auf einen Blick</h2><p>Deine Teamstruktur bleibt verständlich, auch wenn sie wächst.</p><div className="tm-stat"><strong>5</strong><span>Assistenzkräfte in zwei Teams</span></div><div className="tm-stat"><strong>3</strong><span>Personen mit Koordinationsrechten</span></div><div className="tm-stat"><strong>1</strong><span>Personalakte braucht noch Vertragsdaten</span></div><div className="tm-hint">Teamwechsel laufen über „Überführen“. So wandern alle relevanten Daten mit.</div></aside></div>
      <section className="tm-coordinates"><div className="tm-section-top"><div><div className="tm-eyebrow">Zugänge & Rechte</div><h2>Teamkoordinatoren</h2><p>Verwaltungspersonen mit eigenem Zugang. Sie planen und verwalten nur die Teams, die Du ihnen zuweist, und erscheinen nicht im Dienstplan.</p></div><button className="tm-button" onClick={()=>notify("Koordinator anlegen")}><UserPlus size={16}/>Koordinator anlegen</button></div>
        <div className="tm-coordinators">{["Petra Schmidt","Daniel Krüger","Miriam Voss"].map((name,i)=><div className="tm-coordinator" key={name}><div><div className="tm-coordinator-name">{name}</div><div className="tm-coordinator-email">{name.toLowerCase().replace(" ",".")}@beispiel.de</div></div><div className="tm-access"><button className={`tm-switch ${coordinator[i]?"on":""}`} onClick={()=>setCoordinator(s=>s.map((v,index)=>index===i?!v:v))} aria-label={`Zugang für ${name} ${coordinator[i]?"sperren":"entsperren"}`} aria-pressed={coordinator[i]}><i/></button>{coordinator[i]?"Zugang aktiv":"Zugang gesperrt"}</div><div className="tm-team-actions"><button className="tm-button quiet" onClick={()=>notify(`Einladung für ${name} senden`)} aria-label={`${name} einladen`}><Mail size={16}/></button><button className="tm-button quiet" onClick={()=>notify(`${name} entfernen`)} aria-label={`${name} entfernen`}><Trash2 size={16}/></button></div></div>)}</div>
      </section>
    </div></main>
    <footer className="tm-footer">Teams strukturieren Assistenzkräfte und Dienstpläne. Ein Team kann nur gelöscht werden, wenn ihm keine Mitglieder oder Daten mehr zugeordnet sind.</footer>
    {notice && <div role="status" style={{position:"fixed",right:24,bottom:24,background:"#183d56",color:"#eff8f6",padding:"13px 17px",borderRadius:12,fontSize:13,fontWeight:700,boxShadow:"6px 6px 16px rgba(21,52,73,.22)"}}>{notice}</div>}
  </div>;
}