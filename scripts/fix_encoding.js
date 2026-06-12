const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASS || 'password',
  database: process.env.DB_NAME || 'marmitadb',
  // do not force charset here; we'll convert values manually
};

function mightBeMojibake(s) {
  if (!s) return false;
  // common mojibake marker sequences
  return /Ã[\x80-\xBF]|Ã¡|Ã©|Ã£|Ã§|Ãª|Ãµ/.test(s);
}

function fixString(s) {
  // Interpret stored bytes as latin1 and convert to utf8
  const buf = Buffer.from(s, 'binary');
  const fixed = buf.toString('utf8');
  return fixed;
}

(async function main(){
  const pool = mysql.createPool(dbConfig);
  try {
    const conn = await pool.getConnection();
    await conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    conn.release();

    // Fix items table
    const [items] = await pool.query('SELECT id, name, category FROM items');
    for (const item of items) {
      let updates = {};
      if (item.name && mightBeMojibake(item.name)) {
        const fixed = fixString(item.name);
        if (fixed !== item.name) updates.name = fixed;
      }
      if (item.category && mightBeMojibake(item.category)) {
        const fixed = fixString(item.category);
        if (fixed !== item.category) updates.category = fixed;
      }
      if (Object.keys(updates).length) {
        const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.keys(updates).map(k => updates[k]);
        values.push(item.id);
        await pool.query(`UPDATE items SET ${fields} WHERE id = ?`, values);
        console.log(`Updated item id=${item.id}:`, updates);
      }
    }

    // Fix orders table (customer_name)
    const [orders] = await pool.query('SELECT id, customer_name FROM orders');
    for (const o of orders) {
      if (o.customer_name && mightBeMojibake(o.customer_name)) {
        const fixed = fixString(o.customer_name);
        if (fixed !== o.customer_name) {
          await pool.query('UPDATE orders SET customer_name = ? WHERE id = ?', [fixed, o.id]);
          console.log(`Updated order id=${o.id}: customer_name -> ${fixed}`);
        }
      }
    }

    console.log('Encoding fix completed.');
  } catch (err) {
    console.error('Error during encoding fix:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
