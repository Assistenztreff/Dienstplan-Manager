const { Client } = require("pg");
const m = process.env.APP_DATABASE_URL.match(/^postgresql:\/\/([^:]+):(.*)@([^@\/]+)\/([^?]+)(\?.*)?$/);
const [ , user, pass, host, db ] = m; const [h, p] = host.split(":");
const c = new Client({ user, password: pass, host: h, port: +p, database: db + "_test", ssl: { rejectUnauthorized: false } });
c.connect().then(async () => {
  const r = await c.query("select count(*)::int n from pg_locks where locktype=$1", ["advisory"]);
  console.log(r.rows[0].n); await c.end();
}).catch(e => { console.error("ERR", e.message); process.exit(1); });
