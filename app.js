// server-express.js
const express = require('express')
const { join, dirname } = require('path')
const { fileURLToPath } = require('url')
const { Pool } = require('pg');
const bodyParser = require('body-parser');


const app = express() // initialize app
const port = 3000

// Configuración de la conexión a la base de datos
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'Galaxy Park',
    password: 's3rv3r',
    port: 5432,
});

app.use(express.static('views'))

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));

function generateReservationCode(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function generateMultipleReservationCodes(quantity, length) {
    const codes = [];
    for (let i = 0; i < quantity; i++) {
        codes.push(generateReservationCode(length));
    }
    return codes;
}


app.get('/', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM pases');
        const pases = result.rows;
        client.release();
        res.render('pages/index', {titulo: 'Inicio PA', pases});
    } catch (error) {
        console.error('Error al obtener pases', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta para obtener todas las atracciones
app.get('/atracciones', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM atracciones');
        const atracciones = result.rows;
        client.release();
        console.log(atracciones);
        res.render('pages/atracciones', {titulo: 'Inicio PA', atracciones});
    } catch (error) {
        console.error('Error al obtener atracciones', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.get('/pase/:id', async (req, res) => {
    const paseId = req.params.id;

    try {
        // Obtener información del pase
        const client = await pool.connect();
        const paseResult = await client.query('SELECT * FROM pases WHERE id = $1', [paseId]);
        const pase = paseResult.rows[0];

        // Obtener atracciones incluidas en el pase
        const atraccionesResult = await client.query('SELECT a.* FROM atracciones a INNER JOIN pase_atraccion pa ON a.id = pa.atraccion_id WHERE pa.pase_id = $1', [paseId]);
        const atracciones = atraccionesResult.rows;

        client.release();

        // Combinar información del pase y las atracciones
        const des_pase = {
            id: pase.id,
            nombre: pase.nombre,
            precio: pase.precio,
            atraccionesIncluidas: atracciones
        };

        res.render('pages/plan', {titulo: 'Inicio PA', des_pase});
    } catch (error) {
        console.error('Error al obtener información del pase y atracciones', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta para renderizar la página de compra de pases
app.get('/compra', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM pases');
        const pases = result.rows;
        client.release();
        res.render('pages/compra', { pases });
    } catch (error) {
        console.error('Error al obtener pases', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta para manejar la compra de pases
app.post('/comprar_pase', async (req, res) => {
    console.log(req.body);
    const { pase, cantidad, fecha, nombre, apellido, email, metodo_pago } = req.body;

    try {
        const client = await pool.connect();
        const insertCompraQuery = `
        INSERT INTO compras (pase_id, cantidad, fecha_visita, nombre, apellido, email, metodo_pago)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `;
        const compraResult = await client.query(insertCompraQuery, [pase, cantidad, fecha, nombre, apellido, email, metodo_pago]);
        const compraId = compraResult.rows[0].id;
        // Insertar los códigos de reserva en la base de datos
        
        const codigos = generateMultipleReservationCodes(cantidad, 6);
        
        const insertReservaQuery = `
            INSERT INTO reservas (compra_id, codigo_reserva) VALUES ($1, $2)
        `;
        for (const codigo of codigos) {
            await client.query(insertReservaQuery, [compraId, codigo]);
        }

        client.release();
        res.redirect(`/gracias?codes=${codigos.join(',')}`);
    } catch (error) {
        console.error('Error al realizar la compra', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.get('/gracias', (req, res) => {
    const codes = req.query.codes ? req.query.codes.split(',') : [];
    res.render('pages/codigos', { codes });
});

app.get('/reserva', (req, res) => {
    res.render('pages/reserva');
});

// Ruta para manejar la consulta de reservas
app.post('/consultar_reserva', async (req, res) => {
    const { apellido, codigo_reserva } = req.body;

    try {
        const client = await pool.connect();
        const query = `
            SELECT c.id, c.pase_id, c.cantidad, c.fecha_visita, c.nombre, c.apellido, c.email, c.metodo_pago, r.codigo_reserva
            FROM compras c
            JOIN reservas r ON c.id = r.compra_id
            WHERE c.apellido = $1 AND r.codigo_reserva = $2
        `;
        const result = await client.query(query, [apellido, codigo_reserva]);

        if (result.rows.length > 0) {
            const reserva = result.rows[0];
            console.log(reserva);

            // Obtener las atracciones del pase
            const atraccionesQuery = `
                SELECT a.id, a.nombre, sa.visitada
                FROM pase_atraccion pa
                JOIN atracciones a ON pa.atraccion_id = a.id
                LEFT JOIN seguimiento_atracciones sa ON sa.atraccion_id = a.id AND sa.reserva_id = (SELECT id FROM reservas WHERE codigo_reserva = $2)
                WHERE pa.pase_id = $1
            `;
            const atraccionesResult = await client.query(atraccionesQuery, [reserva.pase_id, codigo_reserva]);
            const atracciones = atraccionesResult.rows;

            console.log(atracciones);

            client.release();
            res.render('pages/detalle_reserva', { reserva, atracciones });

        } else {
            client.release();
            res.send('No se encontró ninguna reserva con los datos proporcionados.');
        }
    } catch (error) {
        console.error('Error al consultar la reserva', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.listen(port, () => {
console.log(`Server listening at http://localhost:${port}`)
})