# Cerdito Cadejo para iPhone

*Gastos personales y ahorros.* En la pantalla de inicio aparece como **Mis gastos**.

Tus finanzas personales con los cerditos Cadejo. Funciona sin internet y **todo se guarda solo en tu teléfono**: esta página no tiene servidor ni recibe tus datos.

## Cómo instalarla en el iPhone

1. Abre el enlace de la app en **Safari**.
2. Toca **Compartir** (o el menú **···** y luego **Compartir**).
3. Elige **Agregar a pantalla de inicio**.
4. Deja activado **Abrir como app web** y toca **Agregar**.

## Diferencias con la versión de Android

| | Android (APK) | iPhone (web) |
|---|---|---|
| Bloqueo | Huella, PIN o patrón del teléfono | PIN propio de la app |
| Avisos en el teléfono | Sí | No (los cerditos salen al abrir la app) |
| Cerditos y música | Sí | Sí |
| Sin internet | Sí | Sí |
| Respaldo | Enviar | Compartir, guardar archivo o abrir archivo |

Haz un respaldo de vez en cuando (Ajustes → Respaldo → Guardar archivo). Si borras la app de la pantalla de inicio, se borran sus datos.

## Cómo se actualiza

Esta versión se genera a partir del `index.html` de la app de Android, sin modificarlo:

```
python3 tools/build-web.py RUTA/app/src/main/assets/index.html RUTA/icono-alcancia.png
```

- `tools/build-web.py`: convierte el archivo, quita los datos personales de los valores por defecto y genera `sw.js`.
- `tools/ios.js`: lo propio de iPhone (PIN, respaldo, sonido e instalación).
- `fonts/`: Figtree y Bricolage Grotesque (licencia SIL OFL 1.1), incluidas para que funcione sin internet.
