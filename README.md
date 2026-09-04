Panel web en [Next.js](https://nextjs.org).

## Fotos reales en el manual (`/docs`)

El manual carga PNG desde `public/docs/manual/screenshots/`. Por defecto las capturas se generan contra el **sitio en producción** ([dashboard publicado](https://www.bocasion.com/out/)), con datos reales y BD conectada—no hace falta tener `npm run dev` en marcha.

1. Una vez: `npm run docs:screenshots:install` (instala Chromium para Playwright).
2. Exporta usuario y contraseña **del entorno que uses para entrar en https://www.bocasion.com/out/** (las mismas que definiste para ese entorno). Sin `export`, Node no las ve:
   - `export MANUAL_SCREENSHOT_USER=tu_usuario && export MANUAL_SCREENSHOT_PASSWORD=tu_clave && npm run docs:screenshots`
   - O en una línea: `MANUAL_SCREENSHOT_USER=… MANUAL_SCREENSHOT_PASSWORD=… npm run docs:screenshots`
3. **Opcional:** otra URL (por ejemplo local):  
   `export MANUAL_SCREENSHOT_BASE_URL=http://127.0.0.1:3000/out`
4. `npm run docs:screenshots`

Los PNG se escriben en `public/docs/manual/screenshots/*.png`. Haz commit si quieres fijar esas capturas en el repo.

**Si la página queda en blanco o el test hace timeout al cargar:** algunos hosts bloquean navegadores automatizados. Prueba con ventana visible:  
`MANUAL_SCREENSHOT_HEADED=1 npm run docs:screenshots`  
Si vuelve a fallar, revisa `public/docs/manual/screenshots/_debug-wait-shell.png` (se genera al timeout).

**Seguridad:** no guardes contraseñas en archivos del proyecto; solo variables de entorno en tu máquina o CI secreto.

---

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
