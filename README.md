# Legends YSM API v0.1 — Servidor externo de prueba

**Este proyecto es una API de distribución experimental, NO es una corrección del cargador de YSM.**

## Probar localmente

```sh
npm start
# Abrir http://localhost:3000/health
# Abrir http://localhost:3000/api/v1/models
npm test
```

## Subir a Render (sin Monkey Network)

1. Crear una cuenta en https://dashboard.render.com/ .
2. Crear un repositorio nuevo en GitHub y subir **el contenido de esta carpeta a la raíz**.
3. En Render: New > Web Service > Connect GitHub y elegir el repositorio.
4. Node / Free. Build command: `npm install --ignore-scripts`; Start command: `npm start`.
5. Esperar a que Render muestre la URL HTTPS. Abrir `https://NOMBRE.onrender.com/health`.
6. `GET /api/v1/models` devolverá inicialmente 0 modelos: esto es intencional porque todavía no se han subido modelos autorizados.

Render Free apaga la instancia tras 15 minutos sin tráfico y el sistema de archivos no es persistente. La app no guarda archivos ahí.

## Almacenamiento posterior (Supabase Storage)

- Crear un bucket **privado** en Supabase Storage, por ejemplo `legends-ysm-models`.
- Subir únicamente personajes propios o con permiso explícito de redistribución. NO extraer ni publicar automáticamente los modelos del JAR de YSM.
- Crear manifiesto `data/catalog.json` con identificadores válidos y rutas dentro del bucket. Ejemplo en `examples/catalog.example.json`. Los SHA-256 del ejemplo son marcadores y DEBEN reemplazarse por los hashes reales.
- Opciones de entorno en Render (no subir claves a GitHub):
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (estrictamente servidor)
  - `SUPABASE_BUCKET`
  - `ENABLE_DOWNLOADS` **mantener `false`** hasta integrar y comprobar los permisos de Legends.
- El endpoint firmado está planteado para Supabase Auth JWT, que **todavía no está conectado** al autenticador específico de Legends. No activarlo hasta desarrollar esa integración.

## API disponible

- `GET /health`: salud del servicio.
- `GET /api/v1/models`: catálogo público, solo metadatos. Un registro remoto NO indica que esté cargado en YSM.
- `GET /api/v1/models/:id/assets/:tipo`: inhabilitado por defecto. Cuando esté integrado el acceso, devolverá una URL temporal firmada para `geometry`, `texture` o `animations`.

## Trabajo pendiente antes de que cambien skins 3D en Diosesmon

1. Conseguir modelos con autorización de uso y redistribución.
2. Resolver formato/carga de geometría y animaciones del YSM 2.6.5 directamente en el cliente Legends Staff.
3. Integrar la identidad/autorización del clan en la API.
4. Conectar Staff con este endpoint HTTPS y verificar un modelo 3D en Minecraft real.
5. Sincronización de jugadores después de validar la carga local.

No hay servidor Minecraft, bot Discord, ni otros servicios que modificar para probar `/health`.
