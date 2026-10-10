# Guía de gestión de proyectos de Acme S.A.S.
Versión 2.5 · Uso interno · Responsable: Oficina de proyectos (PMO)

## 1. Propósito
Esta guía define cómo se inician, planean, ejecutan, controlan y cierran los proyectos en Acme. Su objetivo es que todos los proyectos usen el mismo lenguaje, los mismos documentos y los mismos controles, sin importar el área que los lidere.

## 2. ¿Qué es un proyecto?
Es un esfuerzo temporal que busca producir un resultado único, con un inicio, un fin y un presupuesto. Las actividades continuas, como la operación diaria de un área, no son proyectos.

## 3. Clasificación según el presupuesto
El tamaño del proyecto determina qué controles necesita:

| Tipo | Presupuesto | Quién lo aprueba | Control |
|---|---|---|---|
| Pequeño | Hasta 20.000.000 de pesos | Gerente de área | Informe mensual |
| Mediano | Entre 20.000.001 y 150.000.000 de pesos | Comité de proyectos | Informe semanal |
| Grande | Más de 150.000.000 de pesos | Gerencia general | Informe semanal y revisión mensual con el patrocinador |

## 4. Fases del proyecto
1. **Inicio.** Se justifica el proyecto y se nombra al gerente de proyecto y al patrocinador.
2. **Planeación.** Se definen el alcance, el cronograma, el presupuesto, los riesgos y el equipo.
3. **Ejecución.** Se hace el trabajo y se entregan los productos.
4. **Seguimiento y control.** Se mide el avance y se gestionan los cambios.
5. **Cierre.** Se entrega formalmente el resultado y se documentan las lecciones aprendidas.

## 5. Documentos obligatorios
| Código | Documento | Cuándo se entrega |
|---|---|---|
| PM-01 | Acta de constitución | Al iniciar |
| PM-02 | Plan del proyecto | Antes de la ejecución |
| PM-03 | Informe de estado | Semanal, los viernes |
| PM-04 | Registro de riesgos | Se actualiza cada semana |
| PM-05 | Solicitud de cambio | Cuando haya una variación |
| PM-06 | Acta de cierre | Al terminar |

Los proyectos pequeños pueden unificar el PM-01 y el PM-02 en un solo documento.

## 6. Roles y responsabilidades (RACI)
En la matriz, R significa responsable de ejecutar, A responsable final, C consultado e I informado.

| Actividad | Gerente de proyecto | Patrocinador | Equipo | PMO |
|---|---|---|---|---|
| Acta de constitución | R | A | C | I |
| Plan del proyecto | A | I | R | C |
| Informe semanal | A | I | R | I |
| Cambios al alcance | R | A | C | I |
| Cierre del proyecto | R | A | C | I |

## 7. Control de cambios
Cualquier variación al alcance, al cronograma o al presupuesto debe formalizarse con una solicitud de cambio PM-05. La aprobación depende de la variación del presupuesto frente al valor aprobado:

| Variación del presupuesto | Quién aprueba |
|---|---|
| Hasta el 5 % | El gerente de proyecto |
| Entre el 5 % y el 10 % | El patrocinador |
| Más del 10 % | El comité de proyectos |

Un cambio no aprobado no se ejecuta. El gerente de proyecto responde por documentar todos los cambios aunque sean pequeños.

## 8. Gestión de riesgos
Cada riesgo se valora con dos números de 1 a 5: la probabilidad de que ocurra y el impacto si ocurre. El nivel de riesgo es el producto de los dos.

| Nivel | Puntaje | Acción |
|---|---|---|
| Bajo | De 1 a 7 | Se monitorea |
| Medio | De 8 a 14 | Se define una respuesta y un responsable |
| Alto | 15 o más | Requiere un plan de mitigación y se informa al patrocinador |

### Ejemplo
Un riesgo tiene probabilidad 4 e impacto 4. Su nivel es 4 × 4 = 16, que es alto y exige un plan de mitigación.

## 9. Presupuesto y contingencia
Todo proyecto reserva una contingencia del 10 % del presupuesto para imprevistos. La contingencia solo se usa con autorización del patrocinador, y lo no usado se devuelve al terminar el proyecto.

## 10. Medición del avance
Para medir el desempeño se usan dos índices:

- **Índice de desempeño del cronograma (SPI)** = valor ganado ÷ valor planeado.
- **Índice de desempeño del costo (CPI)** = valor ganado ÷ costo real.

Un índice por debajo de 1 indica retraso o sobrecosto. Un índice por debajo de 0,9 se escala al comité de proyectos.

### Ejemplo
A mitad del proyecto, el valor planeado es de 50.000.000 de pesos, el valor ganado de 45.000.000 y el costo real de 52.000.000. El SPI es 45 ÷ 50 = 0,90 y el CPI es 45 ÷ 52 = 0,87. El CPI está por debajo de 0,9, así que se escala al comité.

## 11. Reuniones
| Reunión | Frecuencia | Duración | Participantes |
|---|---|---|---|
| Arranque (kick-off) | Una vez | 1 hora | Todo el equipo y el patrocinador |
| Seguimiento | Semanal | 30 minutos | Equipo del proyecto |
| Comité de proyectos | Mensual | 1 hora | Patrocinadores y PMO |

## 12. Cierre del proyecto
Al terminar, el gerente de proyecto debe:

1. Obtener la aceptación del resultado por parte del patrocinador.
2. Entregar el acta de cierre PM-06.
3. Realizar una reunión de lecciones aprendidas en un máximo de 10 días hábiles.
4. Archivar toda la documentación en el repositorio de la PMO.
5. Liberar al equipo y cerrar los centros de costo.

## 13. Ejemplo completo: un proyecto mediano
El área comercial propone renovar su sistema de cotizaciones, con un presupuesto de 80.000.000 de pesos.

1. **Clasificación.** Está entre 20.000.001 y 150.000.000, así que es un proyecto **mediano**: lo aprueba el comité de proyectos y exige informe semanal.
2. **Contingencia.** Se reserva el 10 %, es decir, 8.000.000 de pesos.
3. **Un cambio.** A mitad del proyecto, el área pide agregar un módulo que cuesta 6.000.000 de pesos. Eso es el 7,5 % del presupuesto, que está entre el 5 % y el 10 %, así que lo aprueba el **patrocinador**.
4. **Un riesgo.** Se identifica que el proveedor de la plataforma podría retrasarse: probabilidad 3 e impacto 5. El nivel es 3 × 5 = 15, que es alto y exige un plan de mitigación.
5. **Cierre.** El proyecto termina, se entrega el acta PM-06 y la reunión de lecciones aprendidas se realiza dentro de los 10 días hábiles siguientes.

## 14. Contenido del informe de estado (PM-03)
El informe semanal debe incluir:

- Porcentaje de avance real contra el planeado.
- Hitos cumplidos en la semana y los de la semana siguiente.
- Presupuesto gastado y el que se proyecta gastar.
- Riesgos nuevos o que cambiaron de nivel.
- Cambios solicitados y su estado.
- Decisiones que se necesitan del patrocinador.

Se entrega los viernes y se resume en una sola página.

## 15. Glosario
| Término | Significado |
|---|---|
| Alcance | Lo que el proyecto va a entregar y lo que no |
| Hito | Punto del cronograma que marca un resultado importante |
| Línea base | Versión aprobada del alcance, cronograma y presupuesto |
| Valor planeado (PV) | Valor del trabajo que se debía haber hecho a la fecha |
| Valor ganado (EV) | Valor del trabajo realmente hecho a la fecha |
| Costo real (AC) | Lo que realmente se ha gastado a la fecha |
| Patrocinador | Persona que respalda el proyecto y tiene la decisión final |
| Contingencia | Reserva del presupuesto para imprevistos |
