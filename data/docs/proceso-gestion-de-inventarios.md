# Proceso de gestión de inventarios de Acme S.A.S.
Versión 2.2 · Uso interno · Responsable: Jefatura de bodega

## 1. Propósito
Este proceso define cómo se recibe, almacena, cuenta y controla la mercancía en las bodegas de Acme. Su objetivo es que el inventario físico coincida con el que figura en el sistema y que siempre haya existencias de los productos que se venden.

## 2. Estructura de la bodega
La bodega se divide en zonas, y cada ubicación se identifica con un código de tres partes: zona, pasillo y nivel.

| Zona | Uso |
|---|---|
| A | Productos de alta rotación |
| B | Productos de rotación media |
| C | Productos de baja rotación |
| D | Devoluciones y productos en cuarentena |

Una ubicación se escribe `A-03-B2`: zona A, pasillo 03, nivel B, posición 2. Nunca se almacena mercancía sin ubicación asignada en el sistema.

## 3. Recepción de mercancía
1. El proveedor presenta la remisión y la orden de compra.
2. El auxiliar de bodega verifica que la orden exista y esté vigente.
3. Se cuenta la mercancía y se compara con la remisión.
4. Se inspecciona un 10 % de las unidades de cada lote para verificar su calidad.
5. Se registra la entrada en el sistema y se asigna la ubicación.
6. Si hay diferencias o daños, se deja constancia en la remisión y se avisa a Compras en el mismo día.

La mercancía recibida con inconsistencias queda en la zona D hasta que se resuelva.

## 4. Clasificación ABC
Las referencias se clasifican según su participación en el valor del inventario. La clasificación se actualiza cada trimestre.

| Clase | Porcentaje de referencias | Porcentaje del valor | Frecuencia de conteo |
|---|---|---|---|
| A | 20 % | 80 % | Mensual |
| B | 30 % | 15 % | Trimestral |
| C | 50 % | 5 % | Semestral |

Las referencias clase A se ubican en las zonas más accesibles y son las que más se vigilan.

## 5. Conteo cíclico
En lugar de contar toda la bodega una vez al año, se cuenta un grupo de referencias cada semana, de acuerdo con la frecuencia de su clase.

Tolerancias aceptadas por diferencia en el conteo, medidas sobre el valor de la referencia:

| Clase | Diferencia aceptada |
|---|---|
| A | 0,5 % |
| B | 1,0 % |
| C | 2,0 % |

Una diferencia por encima de la tolerancia se vuelve a contar, y si persiste, se abre una investigación con el formulario IN-03 de ajuste de inventario.

## 6. Punto de reorden
El punto de reorden indica cuándo hay que pedir nuevamente un producto. Se calcula con esta fórmula:

`Punto de reorden = demanda diaria × plazo de entrega en días + stock de seguridad`

### Ejemplo
Un producto se vende 40 unidades al día, el proveedor tarda 7 días en entregar y el stock de seguridad es de 100 unidades. El punto de reorden es 40 × 7 + 100 = **380 unidades**. Cuando las existencias bajan a 380, se genera la orden de compra.

El stock de seguridad se revisa cada trimestre y depende de qué tan variable sea la demanda y la puntualidad del proveedor.

## 7. Rotación de productos con vencimiento
Los productos con fecha de vencimiento se despachan con la regla FEFO (primero en vencer, primero en salir). El sistema genera una alerta cuando faltan 60 días para el vencimiento de un lote, y el lote se retira de la venta normal cuando faltan 30 días.

## 8. Mermas y bajas
Las mermas son pérdidas de mercancía por daño, vencimiento o extravío. Dar de baja un producto requiere la autorización según su valor:

| Valor de la baja | Autoriza |
|---|---|
| Hasta 500.000 pesos | Jefe de bodega |
| Entre 500.001 y 3.000.000 de pesos | Controller |
| Más de 3.000.000 de pesos | Gerencia financiera |

Toda baja se soporta con fotografías, el acta de la causa y el formulario IN-03.

## 9. Inventario físico anual
Cada año se hace un inventario físico completo los días 28, 29 y 30 de diciembre. Durante esos días no se despachan pedidos ni se reciben mercancías. El resultado se concilia con contabilidad antes del cierre anual.

## 10. Seguridad de la bodega
- El acceso a la bodega está restringido al personal autorizado, con carné.
- Los visitantes siempre van acompañados y registran su ingreso.
- La mercancía de alto valor se guarda en una jaula con llave a cargo del jefe de bodega.
- Hay cámaras en todas las zonas, y sus registros se conservan 30 días.

## 11. Indicadores
| Indicador | Meta |
|---|---|
| Exactitud del inventario | 98 % o más |
| Rotación de inventario | 8 veces al año |
| Pedidos despachados completos | 95 % |
| Mermas sobre el valor del inventario | Menos del 0,5 % |

## 12. Consulta de rotación
Para identificar las referencias que no se han movido en 180 días:

```sql
SELECT referencia, descripcion, ultima_salida
  FROM inventario
 WHERE ultima_salida < current_date - 180
   AND existencias > 0
 ORDER BY ultima_salida;
```

## 13. Casos prácticos

### Caso 1: una diferencia en un conteo
Una referencia clase A tiene un valor en libros de 20.000.000 de pesos. En el conteo hay una diferencia de 80.000 pesos, que es el 0,4 %. Está por debajo de la tolerancia del 0,5 % y se ajusta. Si la diferencia fuera de 150.000 pesos (0,75 %), supera la tolerancia: se recuenta y, si persiste, se abre el formulario IN-03.

### Caso 2: un punto de reorden
Un producto se vende 25 unidades al día, el proveedor tarda 10 días y el stock de seguridad es de 60 unidades. El punto de reorden es 25 × 10 + 60 = **310 unidades**.

### Caso 3: una baja por daño
En la bodega se dañan por una gotera mercancías con un valor de 2.400.000 pesos. Está entre 500.001 y 3.000.000, así que la baja la autoriza el controller, con fotografías y acta de la causa. Si el valor fuera de 400.000 pesos, la autorizaría el jefe de bodega.

### Caso 4: la rotación del inventario
El costo de ventas del año fue de 960.000.000 de pesos y el inventario promedio de 120.000.000. La rotación es 960 ÷ 120 = **8 veces al año**, que es justo la meta.

## 14. Roles
| Rol | Responsabilidad |
|---|---|
| Auxiliar de bodega | Recibir, ubicar, alistar y contar la mercancía |
| Jefe de bodega | Responder por el inventario y autorizar bajas menores |
| Controller | Revisar los ajustes y autorizar bajas intermedias |
| Compras | Generar las órdenes cuando se llega al punto de reorden |

## 15. Glosario
| Término | Significado |
|---|---|
| SKU / referencia | Código único de un producto |
| FEFO | Primero en vencer, primero en salir |
| Merma | Pérdida de mercancía por daño, vencimiento o extravío |
| Cuarentena | Zona donde se aísla mercancía con inconsistencias |
| Stock de seguridad | Existencias extra para cubrir variaciones de demanda o de entrega |
| Conteo cíclico | Conteo de un grupo de referencias cada semana, en lugar de uno anual |
| Rotación | Cuántas veces al año se renueva el inventario |
