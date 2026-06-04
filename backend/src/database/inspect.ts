import pool from './connection'

async function main() {
  try {
    const res = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`)
    console.log('Tables:', res.rows.map(r => r.table_name))
    process.exit(0)
  } catch (e) {
    console.error('Inspect error:', e)
    process.exit(1)
  }
}

main()
