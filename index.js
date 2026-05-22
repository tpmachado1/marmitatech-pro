const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

const dbConfig = {
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASS || 'password',
    database: process.env.DB_NAME || 'marmitadb'
};

let pool;

async function connectWithRetry() {
    console.log('🔍 [INFRA] Tentando conectar ao MySQL...');
    for (let i = 1; i <= 10; i++) {
        try {
            pool = mysql.createPool(dbConfig);
            await pool.query('SELECT 1');
            console.log('✅ [DATABASE] Conectado ao MySQL com sucesso!');
            return;
        } catch (err) {
            console.log(`⚠️ [DATABASE] Tentativa ${i}/10 falhou. Aguardando...`);
            await new Promise(res => setTimeout(res, 3000));
        }
    }
    process.exit(1);
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => res.render('login'));

// Register route - hashes password
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Usuário e senha são obrigatórios.');
    try {
        const hash = bcrypt.hashSync(password, 10);
        await pool.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);
        res.redirect('/');
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') return res.status(400).send('Usuário já existe.');
        console.error(err);
        res.status(500).send('Erro no banco.');
    }
});

function isBcryptHash(value) {
    return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Usuário e senha são obrigatórios.');
    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.send('<h1>Login Inválido</h1><a href="/">Voltar</a>');
        const user = rows[0];
        let ok = false;
        if (isBcryptHash(user.password)) {
            ok = bcrypt.compareSync(password, user.password);
        } else {
            ok = password === user.password;
            if (ok) {
                const hashed = bcrypt.hashSync(password, 10);
                await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
            }
        }
        if (ok) return res.redirect('/dashboard');
        else return res.send('<h1>Login Inválido</h1><a href="/">Voltar</a>');
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro no banco.');
    }
});

app.post('/add-item', async (req, res) => {
    const { name, category, price } = req.body;
    if (!name || name.trim() === '') return res.status(400).send('Nome inválido.');
    const priceNum = parseFloat(price);
    if (Number.isNaN(priceNum) || priceNum <= 0) return res.status(400).send('Preço deve ser número positivo.');
    try {
        await pool.execute('INSERT INTO items (name, category, price) VALUES (?, ?, ?)', [name.trim(), category || null, priceNum]);
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro no banco.');
    }
});

app.post('/orders', async (req, res) => {
    const { customer_name, item_id } = req.body;
    if (!customer_name || customer_name.trim() === '') return res.status(400).send('Nome do cliente inválido.');
    const itemId = parseInt(item_id, 10);
    if (Number.isNaN(itemId)) return res.status(400).send('Item inválido.');
    try {
        const [items] = await pool.execute('SELECT id FROM items WHERE id = ?', [itemId]);
        if (items.length === 0) return res.status(400).send('Item não encontrado.');
        await pool.execute('INSERT INTO orders (customer_name, item_id) VALUES (?, ?)', [customer_name.trim(), itemId]);
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro no banco.');
    }
});

app.post('/orders/:id/advance', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).send('ID inválido.');
    try {
        const [rows] = await pool.execute('SELECT status FROM orders WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).send('Pedido não encontrado.');
        const status = rows[0].status;
        const flow = ['Aberto', 'Cozinha', 'Entrega', 'Entregue'];
        const idx = flow.indexOf(status);
        if (idx === -1 || idx === flow.length - 1) return res.redirect('/dashboard');
        const next = flow[idx + 1];
        await pool.execute('UPDATE orders SET status = ? WHERE id = ?', [next, id]);
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro no banco.');
    }
});

app.get('/admin/export', async (req, res) => {
    try {
        const [orders] = await pool.execute(
            `SELECT o.id, o.customer_name, o.status, o.created_at, i.name AS item_name, i.price AS item_price
            FROM orders o
            LEFT JOIN items i ON o.item_id = i.id
            ORDER BY o.created_at DESC, o.id DESC`
        );

        const header = ['Data do Pedido', 'ID', 'Cliente', 'Item', 'Status', 'Valor (R$)'];
        const csvRows = orders.map(order => {
            const date = order.created_at ? order.created_at.toISOString().slice(0, 19).replace('T', ' ') : '';
            const price = order.item_price != null ? Number(order.item_price).toFixed(2) : '0.00';
            return [date, order.id, order.customer_name || '', order.item_name || '', order.status || '', price];
        });

        const csv = '\uFEFF' + [header, ...csvRows]
            .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(';'))
            .join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="relatorio-vendas.csv"');
        res.send(csv);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao gerar relatório.');
    }
});

app.get('/dashboard', async (req, res) => {
    try {
        const [items] = await pool.execute('SELECT * FROM items');
        const [orders] = await pool.execute('SELECT o.*, i.name AS item_name FROM orders o LEFT JOIN items i ON o.item_id = i.id');
        res.render('dashboard', { items, orders });
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro no banco.');
    }
});

async function ensureSchema() {
    try {
        const [columns] = await pool.execute("SHOW COLUMNS FROM orders LIKE 'created_at'");
        if (columns.length === 0) {
            console.log('🔧 [DATABASE] Adicionando coluna created_at em orders...');
            await pool.execute("ALTER TABLE orders ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
            console.log('✅ [DATABASE] Coluna created_at adicionada com sucesso.');
        }
    } catch (err) {
        console.error('Erro ao garantir esquema do banco de dados:', err);
        process.exit(1);
    }
}

async function ensureUserPasswordColumn() {
    try {
        const [columns] = await pool.execute("SHOW COLUMNS FROM users LIKE 'password'");
        if (columns.length > 0) {
            const type = columns[0].Type || '';
            const match = type.match(/^varchar\((\d+)\)/i);
            const size = match ? parseInt(match[1], 10) : 0;
            if (size > 0 && size < 255) {
                console.log('🔧 [DATABASE] Ajustando coluna password para VARCHAR(255)...');
                await pool.execute('ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL');
                console.log('✅ [DATABASE] Coluna password ajustada com sucesso.');
            }
        }
    } catch (err) {
        console.error('Erro ao ajustar coluna password:', err);
        process.exit(1);
    }
}

async function ensureUserPasswordsHashed() {
    try {
        const [users] = await pool.execute('SELECT id, password FROM users');
        for (const user of users) {
            if (user.password && !isBcryptHash(user.password)) {
                const hashed = bcrypt.hashSync(user.password, 10);
                await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
                console.log(`🔐 [DATABASE] Senha do usuário id=${user.id} convertida para hash.`);
            }
        }
    } catch (err) {
        console.error('Erro ao migrar senhas de usuário:', err);
        process.exit(1);
    }
}

connectWithRetry().then(async () => {
    await ensureSchema();
    await ensureUserPasswordColumn();
    await ensureUserPasswordsHashed();
    app.listen(3000, () => console.log('🚀 MARMITATECH PRO ONLINE NA PORTA 3000'));
});
