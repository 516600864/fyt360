require('dotenv').config({ path: 'D:/Hope/fyt360/fyt360/.env' });
const G = 'https://' + process.env.TCB_ENV + '.api.tcloudbasegateway.com/v1/rdb/exec-pgsql';
const GH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TCB_API_KEY };
const q = async (sql) => (await (await fetch(G, { method: 'POST', headers: GH, body: JSON.stringify({ sql, role: 'cloudbase_postgres' }) })).json());
(async () => {
  console.log('=== order cols ==='); console.log(JSON.stringify(await q("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'order' ORDER BY ordinal_position")));
  console.log('=== order idx ==='); console.log(JSON.stringify(await q("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'order'")));
  console.log('=== user_coupon idx ==='); console.stringify(JSON.stringify(await q("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='user_coupon'")));
})();
