# Procedimiento de cierre contable mensual de Acme S.A.S.
Versión 3.3 · Uso interno · Responsable: Contabilidad

## 1. Objetivo
Este procedimiento establece las actividades, los responsables y los plazos para cerrar cada mes contable y entregar los estados financieros a la gerencia. Lo siguen el área de Contabilidad, Tesorería, Compras, Nómina y los demás procesos que alimentan el sistema contable.

## 2. Calendario del cierre
Los plazos se cuentan en días hábiles posteriores al último día del mes (D+1 es el primer día hábil del mes siguiente).

| Día | Actividad | Responsable |
|---|---|---|
| D+1 | Cierre de los módulos de compras e inventarios | Compras y Bodega |
| D+1 | Cierre de la nómina del mes | Nómina |
| D+2 | Conciliaciones bancarias | Tesorería |
| D+2 | Causación de facturas pendientes | Cuentas por pagar |
| D+3 | Provisiones y gastos pagados por anticipado | Contador general |
| D+4 | Depreciaciones y amortizaciones | Contador general |
| D+4 | Deterioro de cartera | Cartera |
| D+5 | Balance de prueba | Contador general |
| D+6 | Revisión de variaciones y ajustes | Jefe de contabilidad |
| D+7 | Aprobación de la gerencia financiera | Gerencia financiera |
| D+8 | Estados financieros definitivos | Contador general |

Los estados financieros se entregan a la gerencia general a más tardar el día hábil 10.

## 3. Prerrequisitos del cierre
Antes de iniciar el cierre contable, deben cumplirse estas condiciones:

1. Todas las facturas del mes están registradas, aunque no se hayan pagado.
2. Las novedades de nómina fueron liquidadas y contabilizadas.
3. El inventario del mes está conciliado entre bodega y contabilidad.
4. No hay documentos en estado borrador en el sistema contable.

El incumplimiento de un prerrequisito detiene el cierre y se informa al jefe de contabilidad.

## 4. Conciliaciones bancarias
Cada cuenta bancaria se concilia mensualmente. Las diferencias entre el extracto y los libros se tratan así:

| Valor de la diferencia | Tratamiento |
|---|---|
| Menos de 50.000 pesos | Se ajusta directamente, sin aprobación adicional |
| Entre 50.000 y 2.000.000 de pesos | Requiere la aprobación del contador general |
| Más de 2.000.000 de pesos | Requiere la aprobación de la gerencia financiera |

Las partidas conciliatorias con más de 60 días de antigüedad se investigan y se informan en el comité mensual de cierre.

## 5. Provisiones
Se provisionan los gastos que ya ocurrieron pero no han sido facturados, siempre que su valor estimado supere los 500.000 pesos. Las provisiones más comunes son:

- Servicios públicos del mes no facturados.
- Honorarios de asesores por servicios prestados.
- Mercancía recibida sin factura.
- Bonificaciones y comisiones causadas.

Cada provisión se reversa en el mes siguiente cuando llega la factura real.

## 6. Depreciación
Los activos fijos se deprecian por el método de línea recta, desde el mes siguiente a su puesta en uso. Las vidas útiles son:

| Tipo de activo | Vida útil |
|---|---|
| Equipos de cómputo | 3 años |
| Vehículos | 5 años |
| Maquinaria y equipo | 8 años |
| Muebles y enseres | 10 años |
| Edificaciones | 40 años |

### Ejemplo
Un equipo de cómputo cuesta 6.000.000 de pesos y se pone en uso en marzo. Su vida útil es de 3 años, es decir, 36 meses. La depreciación mensual es 6.000.000 ÷ 36 = 166.667 pesos, y empieza en abril.

## 7. Deterioro de cartera
Las facturas vencidas se deterioran según su antigüedad:

| Días de vencimiento | Porcentaje de deterioro |
|---|---|
| Más de 90 días | 25 % |
| Más de 180 días | 50 % |
| Más de 360 días | 100 % |

El deterioro se calcula sobre el saldo de cada factura. El castigo definitivo de la cartera requiere la aprobación de la gerencia financiera y un concepto jurídico.

## 8. Lista de verificación del cierre
| Código | Verificación | Quién la firma |
|---|---|---|
| CC-01 | Módulos auxiliares cerrados | Contador general |
| CC-02 | Conciliaciones bancarias firmadas | Tesorería |
| CC-03 | Provisiones registradas y soportadas | Contador general |
| CC-04 | Depreciaciones calculadas | Contador general |
| CC-05 | Deterioro de cartera registrado | Cartera |
| CC-06 | Balance de prueba cuadrado | Jefe de contabilidad |
| CC-07 | Variaciones mayores al 10 % explicadas | Jefe de contabilidad |
| CC-08 | Estados financieros aprobados | Gerencia financiera |

## 9. Análisis de variaciones
Se compara el mes contra el mismo mes del año anterior y contra el presupuesto. Toda cuenta con una variación mayor al 10 % y superior a 1.000.000 de pesos debe explicarse por escrito antes de la aprobación.

## 10. Consulta de verificación
Para comprobar que el balance de prueba cuadra, se usa esta consulta. La diferencia debe ser cero:

```sql
SELECT sum(debito) AS total_debitos,
       sum(credito) AS total_creditos,
       sum(debito) - sum(credito) AS diferencia
  FROM movimientos_contables
 WHERE periodo = '2026-09';
```

Si la diferencia no es cero, se revisan primero los documentos creados o modificados después de la fecha de corte.

## 11. Cierre anual
El cierre de diciembre incluye pasos adicionales: inventario físico, conciliación de saldos con clientes y proveedores, y la elaboración de las notas a los estados financieros. Los plazos del cierre de diciembre se amplían a D+15 para los estados definitivos.

## 12. Reglas de control
- Ninguna persona puede registrar y aprobar el mismo documento.
- Los asientos manuales requieren soporte y la firma del jefe de contabilidad.
- Después del cierre, el período queda bloqueado en el sistema. Reabrirlo requiere la autorización escrita de la gerencia financiera.

## 13. Casos prácticos

### Caso 1: una diferencia en la conciliación
Al conciliar la cuenta principal, la diferencia entre el extracto y los libros es de 1.200.000 pesos. Está entre 50.000 y 2.000.000, así que necesita la aprobación del contador general. Si hubiera sido de 30.000 pesos, Tesorería la habría ajustado directamente.

### Caso 2: deterioro de una factura
Una factura de 8.000.000 de pesos lleva 200 días vencida. Está por encima de 180 días y por debajo de 360, así que se deteriora el 50 %: 4.000.000 de pesos. Si pasa de 360 días, el deterioro es del 100 %, es decir, 8.000.000.

### Caso 3: depreciación de un vehículo
Un vehículo cuesta 60.000.000 de pesos y su vida útil es de 5 años (60 meses). La depreciación mensual es 60.000.000 ÷ 60 = 1.000.000 de pesos.

### Caso 4: ¿se provisiona o no?
El servicio de mantenimiento de diciembre está estimado en 450.000 pesos y aún no llega la factura. Como el valor estimado no supera los 500.000 pesos, no se provisiona. Si el valor estimado fuera de 700.000 pesos, sí se registra la provisión.

## 14. Indicadores del cierre
| Indicador | Meta |
|---|---|
| Días hábiles para tener los estados definitivos | D+8 |
| Ajustes posteriores al cierre | Menos del 2 % de los asientos |
| Conciliaciones bancarias terminadas en D+2 | 100 % |
| Cuentas con variaciones explicadas | 100 % de las mayores al 10 % |
| Asientos manuales sin soporte | 0 |

## 15. Glosario
| Término | Significado |
|---|---|
| Causación | Registrar un gasto o ingreso cuando ocurre, aunque no se haya pagado |
| Conciliación | Comparar los libros contra un extracto o un tercero |
| Provisión | Estimación de un gasto ya incurrido y no facturado |
| Depreciación | Distribución del costo de un activo a lo largo de su vida útil |
| Deterioro | Pérdida de valor estimada de una cuenta por cobrar |
| Balance de prueba | Listado de saldos que verifica que débitos y créditos cuadran |
| Período | Mes contable que se está cerrando |
