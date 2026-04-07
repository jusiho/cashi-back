# Prompt Optimizado: Plan de Trabajo para App de Finanzas (Strapi + Next.js)

Diseña un **plan de trabajo detallado y estructurado** para el desarrollo de una aplicación de gestión financiera personal con las siguientes características:

- Backend en **Strapi** (donde reside la lógica de negocio)
- Frontend en **Next.js**
- Autenticación con **NextAuth**
- Integración con **API de WhatsApp** para registrar gastos
- Sistema de **pagos**
- Gestión de:
  - Bancos
  - Activos
  - Pasivos
  - Gastos

El plan debe enfocarse en **escalabilidad, mantenibilidad y buenas prácticas**, incluyendo principios **SOLID**, arquitectura limpia y separación de responsabilidades.

---

## Steps

### 1. Definir arquitectura general
- Explicar cómo interactúan Strapi, Next.js, NextAuth y APIs externas  
- Justificar decisiones de arquitectura (monolito vs desacoplado)

### 2. Diseño del backend (Strapi)
- Modelado de entidades:
  - Usuarios
  - Cuentas
  - Transacciones
  - Activos
  - Pasivos  
- Organización de lógica de negocio:
  - Services
  - Controllers
  - Policies  
- Aplicación de principios SOLID  
- Manejo de autenticación y permisos  

### 3. Diseño del frontend (Next.js)
- Estructura de carpetas escalable  
- Manejo de estado (React Query, Zustand, etc.)  
- Integración con NextAuth  
- Consumo de API de Strapi  

### 4. Integración con WhatsApp API
- Flujo de registro de gastos vía mensajes  
- Procesamiento de mensajes (parsing)  
- Asociación con usuario autenticado  

### 5. Sistema de pagos
- Integración con proveedor (Stripe u otro)  
- Manejo de suscripciones o pagos únicos  
- Seguridad y validación  

### 6. Buenas prácticas
- Aplicación de SOLID  
- Clean Architecture / Hexagonal Architecture  
- Manejo de errores y logging  
- Testing (unitarios e integración)  

### 7. Escalabilidad
- Estrategias de caching  
- Separación de servicios  
- Preparación para microservicios  

### 8. DevOps y despliegue
- CI/CD  
- Entornos (dev, staging, prod)  
- Contenedores (Docker opcional)  

---

## Output Format

El resultado debe estar estructurado con:

- Títulos claros por sección (H2 / H3)  
- Explicaciones en párrafos bien desarrollados  
- Listas con viñetas para detalles técnicos  
- Diagramas conceptuales descritos en texto cuando sea necesario  
- Ejemplos de estructura de carpetas en bloques de código  

---

## Examples

### Input
Crear plan para app financiera con Strapi y Next.js  

### Output
#### Arquitectura General
La aplicación sigue una arquitectura desacoplada donde Strapi actúa como backend headless...

---

### Input
Plan para app con registro de gastos vía WhatsApp  

### Output
#### Integración con WhatsApp
El sistema utilizará webhooks para recibir mensajes...

---

### Input
Estructura escalable con buenas prácticas  

### Output
#### Backend (Strapi)

/api
/services
/controllers


Se aplican principios SOLID separando responsabilidades...

---

## Rules and Constraints

- No dar explicaciones superficiales; cada sección debe tener profundidad técnica  
- Evitar ambigüedades; especificar tecnologías concretas cuando sea posible  
- Aplicar explícitamente principios **SOLID**  
- Priorizar **escalabilidad y mantenibilidad**  
- No mezclar responsabilidades entre frontend y backend  
- Usar lenguaje técnico claro y profesional  
- Incluir decisiones justificadas, no solo listadas  