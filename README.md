# Smart Predict

> Sistema IoT de telemetría en tiempo real, detección de anomalías en redes de presurización, despacho georreferenciado de cuadrillas y cierre auditado de órdenes de trabajo con interfaz SaaS estilo Linear.

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![CI](https://github.com/manuelamp11/smart-predict/actions/workflows/ci.yml/badge.svg)](https://github.com/manuelamp11/smart-predict/actions/workflows/ci.yml)
[![Jest Tests](https://img.shields.io/badge/Jest-178%20passed-brightgreen.svg)](https://jestjs.io/)
[![Playwright E2E](https://img.shields.io/badge/Playwright-13%20passed-brightgreen.svg)](https://playwright.dev/)
[![ESLint](https://img.shields.io/badge/ESLint-9.x%20clean-blueviolet.svg)](https://eslint.org/)

---

## 1. Descripción General

**Smart Predict** es una plataforma de supervisión operativa y analítica para redes de presurización y distribución de fluidos. Permite capturar y procesar telemetría continua de sensores de campo (presión, temperatura y vibración) mediante una API HTTP RESTful v1, detectar desviaciones operativas en milisegundos, clasificar severidades de alerta (`NORMAL`, `WARNING_L2`, `CRITICAL_ALERT_L1`, `SIN_SEÑAL`), despachar cuadrillas técnicas automáticamente por cuadrante geográfico y auditar con rigor matemático la ventana de estabilización requerida para el cierre de órdenes de trabajo.

La interfaz de usuario implementa un diseño minimalista de nivel SaaS empresarial inspirado en **Linear**, equipado con navegación lateral (App Shell), header contextual, canvas interactivo ("Loops") en pantalla de login y panel drawer para simulación y pruebas QA.

---

## 2. Arquitectura del Proyecto

El proyecto sigue una arquitectura modular desacoplada basada en puertos, modelos de dominio, servicios de aplicación y controladores HTTP:

```text
smart-predict/
├── .github/
│   └── workflows/
│       └── ci.yml              # SCRUM-43: Pipeline de CI (build, lint, unit & E2E tests)
├── public/                     # Interfaz web SPA estilo Linear (diseño modular)
│   └── index.html              # Login animado, Consola CCO, Cuadrilla, Cierre Auditado y Drawer QA
├── src/
│   ├── modules/
│   │   ├── telemetry/          # HU-001 (SCRUM-5) & HU-007 (SCRUM-34): Ingesta, validación y API v1
│   │   │   ├── telemetry.model.ts
│   │   │   └── telemetry.service.ts
│   │   ├── anomaly/            # HU-002 (SCRUM-6) & SCRUM-25: Clasificación y Watchdog de señal
│   │   │   ├── anomaly.model.ts
│   │   │   └── anomaly.service.ts
│   │   ├── routing/            # HU-003 (SCRUM-7): Enrutamiento y despacho geográfico por cuadrante
│   │   │   ├── routing.model.ts
│   │   │   ├── routing.service.ts
│   │   │   └── routing.exception.ts
│   │   └── closure/            # HU-004 (SCRUM-8) & HU-010 (SCRUM-54): Cierre auditado y RBAC
│   │       ├── closure.model.ts
│   │       └── closure.service.ts
│   └── server.ts               # Servidor Express API (v1 HTTP REST) + Servidor de estáticos
├── tests/
│   ├── anomaly/                # Pruebas unitarias de detección de anomalías y watchdog
│   ├── ci/                     # Pruebas unitarias del pipeline de CI GitHub Actions (SCRUM-43)
│   ├── routing/                # Pruebas de enrutamiento y despacho geográfico de cuadrillas
│   ├── telemetry/              # Pruebas unitarias y de integración de la API HTTP v1
│   │   ├── telemetry.api.test.ts
│   │   ├── telemetry.strict.test.ts
│   │   └── telemetry.test.ts
│   ├── closure.test.ts         # Pruebas unitarias de estabilización, auditoría y RBAC
│   └── e2e/
│       └── functional.spec.ts  # 13 pruebas de caja negra Playwright (RTF4 + SCRUM-54)
├── playwright.config.ts        # Configuración Playwright E2E con auto-spawn de servidor web
├── jest.config.js              # Configuración Jest para suites unitarias
├── eslint.config.js            # Configuración estricta de linting ESLint 9
└── tsconfig.json               # Configuración TypeScript strict mode
```

---

## 3. Reglas de Negocio (RN)

* **RN001 (Validación de Rangos Operacionales):** Toda muestra de telemetría debe validar estructura tipada, identificador de dispositivo, timestamp ISO y límites físicos:
  * Temperatura: `-50 °C` a `150 °C`
  * Vibración: `0 mm/s` a `100 mm/s`
  * Presión: `0 PSI` a `500 PSI`
* **RN002 (Clasificación de Anomalías y Umbrales):**
  * Presión nominal de diseño: `40.0 PSI`.
  * `NORMAL`: Desviación $\le 10\%$ (`36.0` a `44.0 PSI`).
  * `WARNING_L2`: Desviación $> 10\%$ y $\le 30\%$ (`44.01` a `52.0 PSI` o `28.0` a `35.99 PSI`).
  * `CRITICAL_ALERT_L1`: Desviación $> 30\%$ sostenida durante **3 ciclos consecutivos** para el mismo sensor (`> 52.0 PSI` o `< 28.0 PSI`).
  * `SIN_SEÑAL`: Dispositivo sin reporte telemétrico por más de `10 minutos` (Watchdog de señal).
* **RN003 (Despacho Geográfico Automático):** Todo evento `CRITICAL_ALERT_L1` asigna automáticamente a la cuadrilla disponible (`status: AVAILABLE`) ubicada en el mismo cuadrante geográfico con menor distancia euclidiana. Si ninguna cuadrilla se encuentra libre, se escala al CCO con motivo `NO_AVAILABLE_STAFF`.
* **RN004 (Ventana de Estabilización de 15 Minutos Continuos - SCRUM-54):**
  * Para cerrar una orden de forma conforme (`CERRADA_CONFORME`), la red debe permanecer estable entre `36.0` y `44.0 PSI` durante 15 minutos continuos (mínimo 30 muestras consecutivas dentro del rango).
  * Si ingresa una lectura fuera de rango durante la auditoría, se aborta inmediatamente el cronómetro, se registra el evento `"Inestabilidad detectada: [valor] PSI a los [minuto]"` y la orden se revierte al estado `EN_INTERVENCION`.
* **RN005 (Cierre Forzado con Control de Acceso RBAC):**
  * Acción reservada exclusivamente al rol `SUPERVISOR_CCO`.
  * Cualquier intento de cierre forzado por parte de `TECNICO_CAMPO` u `OPERADOR_CCO` es denegado con el mensaje `"No tiene permisos para esta acción"`. El formulario ni siquiera es renderizado en el DOM para roles no autorizados.
  * Requiere de manera obligatoria una justificación técnica detallada (mínimo 10 caracteres válidos, no vacía ni conformada únicamente por espacios en blanco).

---

## 4. Trazabilidad de Tickets Jira y Flujo de Trabajo

| Ticket Jira | Historia / Tarea | Rama / Pull Request | Estado |
| :--- | :--- | :--- | :--- |
| `SCRUM-5` | HU-001: Ingesta y validación de telemetría IoT | `feature/SCRUM-5-ingesta-telemetria` | **Finalizado** (Merged en `develop`) |
| `SCRUM-6` | HU-002: Motor de detección de anomalías y racha de 3 ciclos | `feature/SCRUM-6-deteccion-anomalias` | **Finalizado** (Merged en `develop`) |
| `SCRUM-25` | Watchdog de señal y estado `SIN_SEÑAL` | `feature/SCRUM-25-watchdog-sin-senal` | **Finalizado** (Merged en `develop`) |
| `SCRUM-7` | HU-003: Enrutamiento y despacho geográfico por cuadrante | `feature/hu-003-dispatch` | **Finalizado** (Merged en `develop`) |
| `SCRUM-34` | HU-007: API HTTP REST v1 para ingesta y consulta de telemetría | `feature/SCRUM-34-api-http-telemetria` | **Finalizado** (Merged en `develop`) |
| `SCRUM-43` | Tarea técnica: Pipeline de Integración Continua con GitHub Actions | PR #10 (`feature/SCRUM-43-ci-github-actions`) | **Finalizado** (Merged en `develop`) |
| `SCRUM-8` | HU-004: Módulo de Cierre Auditado y RBAC de Supervisor | `feature/SCRUM-8-cierre-auditado-y-ui` | **Finalizado** (Merged en `develop`) |
| `SCRUM-54` | HU-010: Pantalla de Cierre Auditado con cronómetro y lecturas en vivo | `develop` (commits `85c98bf`, `f439528`) | **Finalizado** (Merged en `develop`) |
| `SCRUM-46..62` | App Shell SaaS estilo Linear, Consola CCO, App Móvil y Drawer QA | `develop` | **Finalizado** (Merged en `develop`) |
| `SCRUM-63` | Suite de pruebas funcionales de caja negra Playwright (RTF4) | `develop` | **Finalizado** (Merged en `develop`) |
| `SCRUM-42` | Documentación técnica integral y manual de arquitectura | `develop` | **Finalizado** (Merged en `develop`) |

---

## 5. API HTTP REST v1

El backend Express expone endpoints estandarizados para integración de telemetría y gestión de órdenes:

| Método | Endpoint | Descripción | Roles Autorizados |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/telemetry` | Ingesta de lectura de telemetría individual | Público / Dispositivos IoT |
| `GET` | `/api/v1/telemetry/:deviceId/latest` | Obtener última lectura registrada de un sensor | Público / Operación |
| `POST` | `/api/v1/telemetry/bulk` | Ingesta por lote de lecturas de telemetría | Público / Gateways IoT |
| `POST` | `/api/auth/login` | Autenticación con generación de token de sesión | Todos |
| `GET` | `/api/work-orders/:id` | Consulta de orden de trabajo y estado de auditoría | Autenticado |
| `POST` | `/api/work-orders/:id/simulate-stabilization` | Simulación de ventana de 15 minutos continuos | Supervisor CCO |
| `POST` | `/api/work-orders/:id/close` | Cierre conforme o forzado de la orden de trabajo | Conforme: CCO / Forzado: Supervisor |

---

## 6. Instrucciones de Instalación y Ejecución

### Prerrequisitos
* Node.js v20.x o v22.x
* npm v10.x

### Instalación de dependencias
```bash
npm install
```

### Ejecución de Pruebas Unitarias e Integración (Jest)
Ejecuta los 178 tests unitarios distribuidos en 8 suites de prueba:
```bash
npm test
```
Para ejecutar con reporte de cobertura:
```bash
npm run test:coverage
```

### Ejecución de Pruebas Funcionales E2E (Playwright)
Ejecuta las 13 pruebas de caja negra automatizadas bajo el plan de pruebas RTF4 y criterios de aceptación de SCRUM-54 (levanta el servidor web en segundo plano automáticamente):
```bash
npx playwright test
```
Para ejecutar con la interfaz gráfica interactiva de Playwright:
```bash
npx playwright test --ui
```

### Iniciar la Plataforma Web
Para levantar el servidor Express y abrir la interfaz de usuario en el navegador:
```bash
npm run start:web
```
Luego navega a: **`http://localhost:3000`**

#### Credenciales predeterminadas:
* **Operador CCO:** `operador` / `operador123` (Rol: `OPERADOR_CCO`)
* **Supervisor CCO:** `supervisor` / `supervisor123` (Rol: `SUPERVISOR_CCO`)
* **Técnico de Campo:** `tecnico` / `tecnico123` (Rol: `TECNICO_CAMPO`)

---

## 7. Cobertura de Pruebas E2E Automatizadas (13 Escenarios)

La suite de pruebas E2E valida de extremo a extremo los siguientes casos de prueba funcionales:

* **`CPF-01`**: Login exitoso de `OPERADOR_CCO` y acceso inmediato a la consola de monitoreo.
* **`CPF-03`**: Validación y presentación de errores de credenciales (campos vacíos y clave errónea).
* **`CPF-05`**: Ingesta de lectura válida (`41.2 PSI`) con actualización reactiva en la tarjeta del sensor.
* **`CPF-11`**: Clasificación visual de advertencia (`47.0 PSI`) con cambio de color ámbar, ícono y texto `WARNING_L2`.
* **`CPF-13`**: Clasificación visual de crítico tras 3 ciclos consecutivos (`60.0 PSI` x3) con alerta roja y contador incrementado.
* **`CPF-21`**: Cierre auditado conforme tras ventana de 15 minutos continuos (30/30 muestras en banda nominal).
* **`CPF-22`**: Rechazo por inestabilidad al inyectar pico de `62 PSI` a los `13:45`, registrando alerta y retornando a `EN_INTERVENCION`.
* **`CPF-23`**: Bloqueo de cierre forzado si la justificación técnica está vacía o conformada por espacios en blanco.
* **`CPF-25`**: Control de acceso RBAC que restringe a `TECNICO_CAMPO` el acceso a la pantalla de cierre auditado.
* **`SCRUM-54 CA-1`**: Renderizado de cuenta regresiva en vivo (`15:00` a `00:00`) y barra de progreso durante la auditoría.
* **`SCRUM-54 CA-2`**: Registro tabular en tiempo real de muestras recibidas con timestamps, valores en PSI y badges (`NORMAL` / `FUERA DE RANGO`).
* **`SCRUM-54 CA-3`**: Habilitación del botón explícito `"Cerrar orden"` únicamente al culminar la ventana estable de 15 minutos.
* **`SCRUM-54 CA-4`**: Restricción de montaje en DOM del panel de Cierre Forzado para roles no supervisores (`OPERADOR_CCO`, `TECNICO_CAMPO`).
