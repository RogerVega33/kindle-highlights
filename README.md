# Kindle highlights

Tu biblioteca personal de subrayados y notas de Kindle.

## Demo

![Demo de Kindle highlights](docs/assets/demo.gif)

## Funciones

- **Varios usuarios:** cada cuenta tiene una biblioteca privada e independiente.
- **Importación de Kindle:** importa subrayados y notas desde archivos HTML o HTM.
- **Sin duplicados al reimportar:** añade las anotaciones nuevas y omite las repetidas, conservando las ediciones y portadas existentes.
- **Edición conservando el original:** modifica subrayados y notas y consulta su texto original cuando lo necesites.
- **Eliminación de contenido:** elimina subrayados o notas individualmente, o un libro completo con sus anotaciones y portada.
- **Libros personalizables:** edita el título y el autor sin perder su reconocimiento al reimportar.
- **Portadas propias:** añade, sustituye o elimina las portadas de tus libros.
- **Búsqueda y ordenación:** busca libros por título o autor y ordénalos por actividad reciente, título o autor.
- **Lectura de anotaciones:** busca dentro de cada libro, filtra subrayados o notas y expande o contrae sus secciones.
- **Copiar texto:** copia el contenido de un subrayado o nota al portapapeles.
- **Modo claro y oscuro:** cambia de tema y conserva tu preferencia en el navegador.
- **Diseño adaptable:** utiliza la biblioteca desde un computador, tableta o dispositivo móvil.
- **PWA instalable:** instala la aplicación desde el navegador.
- **Datos persistentes:** libros, anotaciones, ediciones y portadas se guardan en la base de datos y se conservan entre reinicios.

## Instalación

Requiere Docker y Docker Compose. Solo necesitas descargar [compose.prod.yaml](compose.prod.yaml) y [.env.example](.env.example) en una misma carpeta; no necesitas clonar el repositorio ni compilar.

1. Copia `.env.example` como `.env` y configura `PGDATABASE`, `PGUSER` y una contraseña segura en `PGPASSWORD`.
2. Desde esa carpeta ejecuta:

   ```bash
   docker compose -f compose.prod.yaml up -d
   ```

Abre `http://IP_DEL_SERVIDOR:3001` (o [http://localhost:3001](http://localhost:3001) en tu equipo). La base y el esquema se crean automáticamente al iniciar con un volumen vacío; los datos se conservan en un volumen Docker.

Para actualizar la imagen a una nueva versión y recrear los contenedores ejecuta:

```bash
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

Esto solo actualiza las imágenes y conserva los datos ya guardados.

### HTTPS con proxy inverso

Dirige el proxy al puerto `3001` de la aplicación y configura estas cabeceras:

| Cabecera | Valor | Función |
| --- | --- | --- |
| `X-Forwarded-Proto` | `https` | Indica que el acceso público usa HTTPS. |
| `X-Forwarded-Host` | Tu dominio público, con puerto si no es el estándar. | Permite reconocer el dominio público. |
| `X-Forwarded-For` | `$remote_addr` | Identifica la IP del cliente para limitar los intentos de acceso por IP. |

Iniciar sesión, registrarse, recuperar la cuenta y cambiar la contraseña comparten un límite de 20 solicitudes cada 15 minutos por IP, exitosas o fallidas. Sin `X-Forwarded-For`, todos los usuarios del proxy comparten ese límite.

Define `TRUSTED_PROXY_IP` en `.env` con la IP exacta desde la que el proxy llega al contenedor.

En los logs, `peerIp` es la IP de la conexión directa; `clientIp` solo aparece si el proxy envía `X-Forwarded-For` con una IP válida y distinta de `peerIp`.

Si el proxy se ejecuta en el servidor anfitrión, su IP vista por la aplicación puede ser la puerta de enlace de la red Docker. Cuando la red del proyecto ya exista, lista las redes y consulta su puerta de enlace (ajusta `kindle-highlights_default` si tiene otro nombre):

```bash
sudo docker network ls --format '{{.Name}}'
sudo docker network inspect kindle-highlights_default --format '{{range .IPAM.Config}}{{println .Gateway}}{{end}}'
```

Si devuelve `172.20.0.1` y esa es la dirección desde la que llega el proxy, configura `TRUSTED_PROXY_IP=172.20.0.1`. Si el proxy está en otro contenedor de la misma red, utiliza la IP de ese contenedor, que puede ser distinta de la puerta de enlace.

En `compose.prod.yaml`, comenta el `command` HTTP y activa el ejemplo HTTPS comentado; aplica de nuevo `docker compose -f compose.prod.yaml up -d`. Esto permite reconocer HTTPS y emitir cookies `Secure`.

En despliegues HTTPS, restringe el acceso al puerto `3001` para que solo pueda conectarse el proxy; así evitas el acceso directo por HTTP.

## PWA

Puedes instalar la aplicación en tu dispositivo móvil desde el navegador una vez que esté desplegada en un servidor.

- Abre la aplicación mediante HTTPS con un certificado reconocido por el dispositivo.
- En los navegadores compatibles, abre el menú de tu cuenta y elige **Instalar aplicación**. También puedes utilizar la opción de instalación del navegador.
- En iPhone o iPad, abre el menú **Compartir** del navegador y elige **Agregar a pantalla de inicio**.

Consultar y modificar contenido requiere conexión con el servidor.

## Desarrollo

Con el repositorio descargado, crea `.env` a partir de `.env.example` y configura `PGDATABASE`, `PGUSER` y `PGPASSWORD`. Desde la raíz del proyecto, elige una de estas dos opciones; ambas utilizan `compose.yaml`.

### Todo con Docker

Requiere únicamente Docker y Docker Compose. Este comando compila y levanta la aplicación y PostgreSQL:

```bash
docker compose up -d --build
```

Abre [http://localhost:3001](http://localhost:3001). Después de modificar el código, ejecuta el mismo comando para reconstruir y actualizar la aplicación, conservando los datos.

Para detener todo, usa `docker compose stop`.

### PostgreSQL en Docker y aplicación con Node.js

Requiere además Node.js 22.19 o posterior. Aquí solo la base se ejecuta en Docker; Vite y la API se ejecutan directamente en tu equipo.

1. Añade a `.env` la dirección y el puerto de la base para el servidor local:

   ```dotenv
   PGHOST=127.0.0.1
   PGPORT=5432
   ```

2. Inicia sólo la base de datos y espera a que esté disponible:

   ```bash
   docker compose up -d --wait database
   ```

   `--wait` espera a que PostgreSQL esté disponible; si falla, resuelve el error antes de continuar.

3. Instala las dependencias y arranca Vite y la API:

   ```bash
   npm ci
   npm run dev
   ```

Abre [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite utiliza el puerto 5173 y la API, el 3001. La API crea el esquema automáticamente si la base está vacía.

Para terminar, pulsa `Ctrl+C` para detener Vite y la API, y ejecuta `docker compose stop database` para detener PostgreSQL, conservando sus datos.

Producción utiliza `compose.prod.yaml`. Si también la ejecutas en este equipo, usa `-p kindle-highlights-dev` en todos los comandos Compose de desarrollo para separar sus recursos. Esto no cambia los puertos: asigna un puerto distinto a una de las aplicaciones y ajusta el destino del proxy correspondiente. Las instrucciones anteriores asumen que el puerto `3001` está libre.

## Documentación

| Guía                                 | Contenido |
|--------------------------------------| --- |
| [Arquitectura](docs/architecture.md) | Organización del código y flujo de datos. |
| [Base de datos](docs/database.md)    | Configuración, inicialización, tablas, backups y restauración. |

## Licencia

Copyright 2026 Roger Vega.

Este proyecto se distribuye bajo la [Apache License 2.0](LICENSE). Consulta
también el archivo de [atribuciones](NOTICE). Las dependencias de terceros
conservan sus respectivas licencias.
