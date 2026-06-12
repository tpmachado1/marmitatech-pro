const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASS || 'password',
    database: process.env.DB_NAME || 'marmitadb'
};

let pool;

async function connectWithRetry() {
    console.log('🔍 [INFRA] Tentando conectar ao MySQL...');
    const maxAttempts = 10;
    for (let i = 1; i <= maxAttempts; i++) {
        try {
            pool = mysql.createPool({
                host: dbConfig.host,
                port: dbConfig.port,
                user: dbConfig.user,
                password: dbConfig.password,
                database: dbConfig.database,
                waitForConnections: true,
                connectionLimit: 10,
                connectTimeout: 10000
            });

            // verify connection by getting and releasing a connection
            const conn = await pool.getConnection();
            await conn.ping();
            conn.release();

            console.log('✅ [DATABASE] Conectado ao MySQL com sucesso!');
            return;
        } catch (err) {
            console.log(`⚠️ [DATABASE] Tentativa ${i}/${maxAttempts} falhou: ${err.message}`);
            if (i < maxAttempts) await new Promise(res => setTimeout(res, 3000));
        }
    }
    console.error('❌ [DATABASE] Não foi possível conectar ao MySQL após várias tentativas.');
    process.exit(1);
}

app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets from the public directory (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) {
            return res.send('<h1>Login Inválido</h1><a href="/">Voltar</a>');
        }

        const user = rows[0];
        // Check if password is bcrypt hash or legacy plain text
        const isLegacy = !user.password.startsWith('$2');
        const passwordMatch = isLegacy ? (user.password === password) : await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.send('<h1>Login Inválido</h1><a href="/">Voltar</a>');
        }

        // Auto-upgrade legacy plain text passwords to bcrypt on first login
        if (isLegacy) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);
            console.log(`✅ [AUTH] Upgraded password for user: ${username}`);
        }

        res.redirect('/dashboard');
    } catch (err) {
        console.error('❌ [AUTH] Login error:', err);
        res.status(500).send("Erro no banco.");
    }
});

app.get('/dashboard', async (req, res) => {
    const [items] = await pool.query('SELECT * FROM items');
    const [orders] = await pool.query(
        `SELECT o.*, i.name AS item_name, i.category AS item_category
         FROM orders o
         LEFT JOIN items i ON o.item_id = i.id
         ORDER BY o.id DESC`
    );
    res.render('dashboard', { items, orders });
});

// Create a new order
app.post('/orders', async (req, res) => {
    const { customer_name, item_id } = req.body;
    try {
        await pool.query('INSERT INTO orders (customer_name, item_id, status) VALUES (?, ?, ?)', [customer_name, item_id || null, 'Aberto']);
        res.redirect('/dashboard');
    } catch (err) {
        console.error('[ORDERS] create error:', err);
        res.status(500).send('Erro ao criar pedido');
    }
});

// Advance an order to the next status
app.post('/orders/:id/advance', async (req, res) => {
    const id = req.params.id;
    const statuses = ['Aberto', 'Cozinha', 'Entrega', 'Entregue'];
    try {
        const [rows] = await pool.query('SELECT status FROM orders WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Pedido não encontrado');
        const current = rows[0].status || 'Aberto';
        const idx = statuses.indexOf(current);
        const nextStatus = (idx >= 0 && idx < statuses.length - 1) ? statuses[idx + 1] : current;
        await pool.query('UPDATE orders SET status = ? WHERE id = ?', [nextStatus, id]);
        res.redirect('/dashboard');
    } catch (err) {
        console.error('[ORDERS] advance error:', err);
        res.status(500).send('Erro ao avançar pedido');
    }
});

// Delete an order (used for delivered orders)
app.post('/orders/:id/delete', async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query('DELETE FROM orders WHERE id = ?', [id]);
        res.redirect('/dashboard');
    } catch (err) {
        console.error('[ORDERS] delete error:', err);
        res.status(500).send('Erro ao excluir pedido');
    }
});

connectWithRetry().then(() => {
    app.listen(3000, () => console.log('🚀 MARMITATECH PRO ONLINE NA PORTA 3000'));
});
