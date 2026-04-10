# AgroPulse

Plataforma comunitaria agrícola para compartir recursos, servicios y conocimiento entre agricultores de la región. Permite publicar ofertas, solicitudes, préstamos y trueques, chatear en tiempo real y completar intercambios con calificación mutua.

## Requisitos

- Python 3.8 o superior
- Sin dependencias externas (solo librería estándar de Python)

## Cómo correr el servidor

```bash
python3 server.py
```

La base de datos se inicializa automáticamente. El servidor corre en `http://localhost:8080`

## Deploy en Render

1. Sube el repo a GitHub
2. Entra a [render.com](https://render.com) y crea una cuenta gratis
3. New > Web Service > conecta tu repo
4. Render detecta `render.yaml` automáticamente
5. Click en "Create Web Service"

La app queda en `https://agropulse.onrender.com` (o el nombre que elijas)

## Estructura del proyecto

```
AgroPulse/
├── server.py          # Servidor HTTP + API REST
├── db.py              # Base de datos SQLite + schema + datos demo
├── auth.py            # Hashing de passwords y manejo de sesiones
└── static/
    ├── index.html     # App principal (SPA)
    ├── css/
    │   └── styles.css
    └── js/
        ├── app.js     # Lógica principal
        ├── api.js     # Cliente API
        ├── chat.js    # Chat con polling
        └── geo.js     # Geolocalización
```

## Flujo de uso

1. Registrarse con nombre, correo y contraseña
2. Publicar un recurso (oferta, solicitud, préstamo o trueque)
3. Otros usuarios lo encuentran en el mercado y hacen clic en "Me interesa"
4. El dueño ve la solicitud y acepta desde el chat
5. Ambos chatean en tiempo real
6. El dueño marca el servicio como completado
7. Ambos se califican mutuamente

## API

El servidor expone una API REST en `/api/`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/register` | Registro |
| POST | `/api/login` | Login |
| GET | `/api/resources` | Listar recursos |
| POST | `/api/resources` | Crear recurso |
| GET/POST | `/api/agreements` | Listar/crear acuerdos |
| PUT | `/api/agreements/<id>` | Actualizar estado |
| POST | `/api/agreements/<id>/rate` | Calificar |
| GET/POST | `/api/agreements/<id>/messages` | Chat |
| GET | `/api/poll` | Polling de mensajes nuevos |
| GET | `/api/users/me` | Perfil del usuario |

## Notas

- La base de datos se guarda en `agropulse.db` (SQLite) y se crea automáticamente al arrancar
- Para empezar desde cero: eliminar `agropulse.db` y reiniciar el servidor
- El servidor usa WAL mode para mejor concurrencia
- `PORT` y `DB_PATH` se pueden configurar con variables de entorno
