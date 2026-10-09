// Acceso a Postgres. Expone el pool compartido, un ping para /health y un
// helper de transacciones. Solo repository.js y server.js lo usan.
import pg from "pg";
import { config } from "./config.js";

// Un Pool reutiliza conexiones abiertas en vez de abrir una por consulta, que
// es lento. Se crea una vez y lo comparte toda la API.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Consulta minima para saber si la base responde (la usa /health).
export async function pingDb() {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return rows[0].ok === 1;
}

// Corre fn dentro de una transaccion: todo se guarda o nada. Hace falta un
// client fijo (no pool.query) porque BEGIN y COMMIT tienen que ir por la misma
// conexion que las consultas de fn.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    // Siempre se devuelve el client al pool, haya error o no. Si no, el pool
    // se agota y la API se queda colgada esperando conexiones.
    client.release();
  }
}
