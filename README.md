# Smart Predict

> Sistema IoT de telemetría en tiempo real, detección de anomalías en redes de presurización, despacho georreferenciado de cuadrillas y cierre auditado de órdenes de trabajo.

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![Jest Tests](https://img.shields.io/badge/Jest-79%20passed-brightgreen.svg)](https://jestjs.io/)
[![Playwright E2E](https://img.shields.io/badge/Playwright-9%20passed-brightgreen.svg)](https://playwright.dev/)
[![ESLint](https://img.shields.io/badge/ESLint-9.x%20clean-blueviolet.svg)](https://eslint.org/)

---

## 1. Descripción General

**Smart Predict** es una plataforma orientada a la supervisión operativa de redes de distribución y fluidos. Permite capturar telemetría continua de sensores de campo (presión, temperatura y vibración), detectar tempranamente desviaciones operativas, clasificar severidades de alerta, despachar cuadrillas técnicas automáticamente por cercanía geográfica en el mismo cuadrante y auditar el proceso de cierre y estabilización técnica de las órdenes de trabajo intervenidas.

---

## 2. Arquitectura Modular

El proyecto adopta principios de arquitectura limpia y desacoplamiento mediante puertos y adaptadores:

```text
smart-predict/
├── public/                     # Interfaz web operativa SPA (4 vistas prototipo)
│   └── index.html              # Login, Consola CCO, App Móvil y Cierre Auditado
├── src/
│   ├── modules/
│   │   ├── telemetry/          # HU-001 (SCRUM-5): Validación e ingesta de telemetría
│   │   │   ├── telemetry.model.ts
│   │   │   └── telemetry.service.ts
│   │   ├── anomaly/            # HU-002 (SCRUM-6) & SCRUM-25: Clasificación y Watchdog
│   │   │   ├── anomaly.model.ts
│   │   │   └── anomaly.service.ts
│   │   ├── routing/            # HU-003: Enrutamiento y despacho por cuadrante
│   │   │   ├── routing.model.ts
│   │   │   ├── routing.service.ts
│   │   │   └── routing.exception.ts
│   │   └── closure/            # HU-004 (SCRUM-8, 18, 19, 20): Cierre auditado y RBAC
│   │       ├── closure.model.ts
│   │       └── closure.service.ts
│   └── server.ts               # Servidor Express API + Servidor estático
├── tests/
│   ├── telemetry/              # Pruebas unitarias de telemetría
│   ├── anomaly/                # Pruebas de motor de anomalías y watchdog
│   ├── routing/                # Pruebas de selección y despacho de cuadrillas
│   ├── closure.test.ts         # Pruebas unitarias de cierre auditado y RBAC
│   └── e2e/
│       └── functional.spec.ts  # Pruebas funcionales de caja negra Playwright (RTF4)
├── playwright.config.ts        # Configuración de Playwright con webServer automático
├── jest.config.js              # Configuración de Jest con exclusión de pruebas E2E
├── eslint.config.js            # Configuración de linting ESLint 9
└── tsconfig.json               # Configuración estricta de TypeScript
```

---

## 3. Reglas de Negocio (RN)

* **RN001 (Validación de Rangos Operacionales):** Toda muestra de telemetría debe contar con `deviceId`, `timestamp` válido y métricas dentro de los rangos seguros:
  * Temperatura: `-50 °C` a `150 °C`
  * Vibración: `0 mm/s` a `100 mm/s`
  * Presión: `0 PSI` a `500 PSI`
* **RN002 (Clasificación de Anomalías y Umbrales):**
  * Presión nominal base: `40.0 PSI`.
  * `NORMAL`: Desviación $\le 10\%$ (`36.0` a `44.0 PSI`).
  * `WARNING_L2`: Desviación $> 10\%$ y $\le 30\%$ (`44.01` a `52.0 PSI` o `28.0` a `35.99 PSI`).
  * `CRITICAL_ALERT_L1`: Desviación $> 30\%$ sostenida durante **3 ciclos consecutivos** para el mismo dispositivo.
  * `SIN_SEÑAL`: Sensor que no reporta telemetría durante más de `10 minutos` (Watchdog).
* **RN003 (Despacho Geográfico Automático):** Todo evento `CRITICAL_ALERT_L1` despacha de forma automática a la cuadrilla disponible (`status: AVAILABLE`) ubicada en el mismo cuadrante con menor distancia euclidiana. Si no hay personal disponible, escala al CCO con motivo `NO_AVAILABLE_STAFF`.
* **RN004 (Ventana de Estabilización de 15 Minutos Continuos):**
  * Para cerrar una orden de trabajo de manera conforme (`CERRADA_CONFORME`), la presión debe permanecer ininterrumpidamente entre `36.0` y `44.0 PSI` durante 15 minutos (mínimo 30 muestras continuas).
  * Si ingresa una lectura fuera de rango (`< 36` o `> 44 PSI`), se aborta la auditoría, se registra el mensaje exacto `"Inestabilidad detectada: [valor] PSI a los [minuto]"` y la orden retorna al estado `EN_INTERVENCION`.
* **RN005 (Cierre Forzado con Control de Acceso RBAC):**
  * Exclusivo para el rol `SUPERVISOR_CCO`.
  * Cualquier intento de cierre por roles como `TECNICO_CAMPO` u `OPERADOR_CCO` es rechazado con el mensaje `"No tiene permisos para esta acción"`.
  * Exige de forma obligatoria una justificación técnica no vacía (no admite espacios en blanco).

---

## 4. Trazabilidad de Tickets Jira y Ramas

| Ticket Jira | Historia / Tarea | Rama de Git | Estado |
| :--- | :--- | :--- | :--- |
| `SCRUM-5` | Ingesta y validación de telemetría IoT | `feature/SCRUM-5-ingesta-telemetria` | Merged en `develop` |
| `SCRUM-6` | Motor de detección de anomalías y racha de 3 ciclos | `feature/SCRUM-6-deteccion-anomalias` | Merged en `develop` |
| `SCRUM-25` | Watchdog de señal y estado `SIN_SEÑAL` | `feature/SCRUM-25-watchdog-sin-senal` | Merged en `develop` |
| `HU-003` / `SCRUM-7` | Enrutamiento y despacho geográfico por cuadrante | `feature/hu-003-dispatch` | Merged en `develop` |
| `SCRUM-8` / `SCRUM-18..20` | HU-004: Módulo de Cierre Auditado y RBAC | `feature/SCRUM-8-cierre-auditado-y-ui` | Implementado |
| `SCRUM-46..58` | Servidor Express + Interfaz Web con 4 vistas operativas | `feature/SCRUM-8-cierre-auditado-y-ui` | Implementado |
| `SCRUM-63` | Suite de pruebas funcionales de caja negra Playwright (RTF4) | `feature/SCRUM-8-cierre-auditado-y-ui` | Implementado |
| `SCRUM-42` | Documentación técnica y arquitectura del sistema | `feature/SCRUM-8-cierre-auditado-y-ui` | Implementado |

---

## 5. Instrucciones de Instalación y Ejecución

### Prerrequisitos
* Node.js v20+ o v22+
* npm v10+

### Instalación de dependencias
```bash
npm install
```

### Ejecución de Pruebas Unitarias e Integración (Jest)
Ejecuta la suite de pruebas unitarias cubriendo telemetría, anomalías, watchdog, routing y cierre auditado:
```bash
npm test
```
Para ver reporte de cobertura:
```bash
npm run test:coverage
```

### Ejecución de Pruebas Funcionales E2E (Playwright)
Ejecuta las pruebas de caja negra automatizadas bajo el plan de pruebas RTF4 (levanta el servidor web automáticamente):
```bash
npx playwright test
```
Para ejecutar con interfaz gráfica de Playwright:
```bash
npx playwright test --ui
```

### Iniciar la Interfaz Web Operativa
Para levantar el servidor Express y probar la consola en el navegador:
```bash
npm run start:web
```
Luego abre en tu navegador: **`http://localhost:3000`**

#### Credenciales predeterminadas:
* **Operador CCO:** `operador` / `operador123` (Rol: `OPERADOR_CCO`)
* **Supervisor CCO:** `supervisor` / `supervisor123` (Rol: `SUPERVISOR_CCO`)
* **Técnico de Campo:** `tecnico` / `tecnico123` (Rol: `TECNICO_CAMPO`)

---

## 6. Escenarios de Prueba Automatizados (RTF4)

La suite de pruebas E2E valida los siguientes casos de prueba funcionales:
* **`CPF-01`**: Login exitoso de `OPERADOR_CCO` y acceso a la consola de monitoreo.
* **`CPF-03`**: Validación de error en credenciales (campo vacío y credenciales erróneas).
* **`CPF-05`**: Ingesta de lectura válida (`41.2 PSI`) con actualización reactiva en la tarjeta del sensor.
* **`CPF-11`**: Clasificación visual de advertencia (`47.0 PSI`) con cambio de color ámbar, ícono y texto.
* **`CPF-13`**: Clasificación visual de crítico tras 3 ciclos (`60.0 PSI` x3) con alerta roja y contador incrementado.
* **`CPF-21`**: Cierre auditado conforme tras ventana de 15 minutos (30/30 muestras en banda nominal).
* **`CPF-22`**: Rechazo por inestabilidad al inyectar pico de `62 PSI` a los `13:45`, retornando a `EN_INTERVENCION`.
* **`CPF-23`**: Bloqueo de cierre forzado si la justificación técnica está vacía o en blanco.
* **`CPF-25`**: Control de acceso RBAC que restringe a `TECNICO_CAMPO` el acceso a la pantalla de cierre auditado.
