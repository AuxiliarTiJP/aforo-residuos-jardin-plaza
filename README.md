# Recorrido de residuos - Jardín Plaza

Aplicación web móvil para registrar visitas únicamente mediante escaneo QR.

## Requisitos

- Node.js 24.x
- npm 11.x
- Cámara disponible en el celular

## Ejecutar localmente

```powershell
npm install
npm run dev
```

Abre `http://localhost:3000`.

### Credenciales de demostración

- Administrador: `admin` / `admin123`
- Operario: `operario` / `operario123`

En modo demostración los usuarios y registros se guardan en `localStorage` del navegador. No es un modo productivo.

## Flujo del operario

1. Iniciar sesión.
2. Permitir acceso a la cámara.
3. Escanear el QR ubicado físicamente en la marca.
4. Seleccionar `Entregó residuos` o `Local cerrado`.
5. La app guarda y vuelve automáticamente a la cámara.

No existe selección manual de marcas ni ingreso manual de códigos.

## Conectar Supabase

1. Crea un proyecto en Supabase.
2. Ejecuta `supabase/schema.sql` en SQL Editor.
3. Copia `.env.example` como `.env.local`.
4. Completa:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

5. Crea el primer administrador como explica el final de `supabase/schema.sql`.
6. Reinicia `npm run dev`.

La clave `SUPABASE_SERVICE_ROLE_KEY` solo se utiliza en rutas del servidor para gestionar trabajadores. Nunca debe llevar el prefijo `NEXT_PUBLIC_`.

## Publicar en Vercel

1. Sube el proyecto a GitHub.
2. Importa el repositorio en Vercel.
3. Configura Node.js 24.x y las tres variables de entorno.
4. Despliega.

La cámara funciona en `localhost` y en sitios HTTPS, como Vercel.

## Códigos QR

Cada QR debe contener exactamente el valor almacenado en `brands.qr_code`, por ejemplo `JP-001`. La aplicación no muestra listas de marcas ni permite escribir códigos manualmente.

## QR de prueba

La carpeta `test-qr` contiene tres imágenes listas para probar el escáner desde otro dispositivo o impresas:

- `JP-001.png`
- `JP-002.png`
- `JP-003.png`

## Funcionamiento sin conexión

La versión 2.1 usa un patrón **local-first** para el recorrido del operario:

1. Al abrir la aplicación con conexión se descargan las marcas activas y se guardan en IndexedDB.
2. Cada registro se guarda primero en el dispositivo, incluso cuando hay internet.
3. Si Supabase no está disponible, el registro permanece con estado pendiente.
4. La aplicación intenta sincronizar al recuperar conexión, al volver a abrirse y mediante el botón **Sincronizar**.
5. El UUID se genera en el dispositivo para que los reintentos sean idempotentes.

Condiciones importantes:

- El trabajador debe iniciar sesión y abrir la aplicación con conexión al menos una vez en cada dispositivo.
- El acceso local del operario se conserva hasta 72 horas desde la última validación online.
- No se debe borrar el almacenamiento del navegador ni desinstalar la PWA mientras existan registros pendientes.
- La sincronización automática más confiable ocurre con la aplicación abierta. Si se cerró, se reintenta al abrirla nuevamente con conexión.
- El panel administrativo continúa requiriendo internet.

La franja debajo de la cámara indica si hay conexión y cuántos registros siguen pendientes.
