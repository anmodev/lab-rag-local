# Guía de seguridad de la información de Acme S.A.S.
Versión 4.1 · Uso interno · Responsable: Oficial de seguridad

## 1. Propósito
Esta guía explica cómo se clasifica, protege y comparte la información de Acme. Complementa las reglas de contraseñas y accesos del Manual del colaborador, que siguen vigentes, y está dirigida a todos los empleados y contratistas.

## 2. Clasificación de la información
Toda información se clasifica en uno de cuatro niveles. El autor del documento es quien lo clasifica; ante la duda, se usa el nivel más alto.

| Nivel | Ejemplos | Quién puede verla | Cómo se comparte |
|---|---|---|---|
| Pública | Catálogos, avisos de prensa | Cualquier persona | Libremente |
| Interna | Manuales, políticas, directorios | Empleados y contratistas | Por correo corporativo |
| Confidencial | Contratos, cotizaciones, datos de clientes | Solo quien lo necesita para su trabajo | Por canales cifrados |
| Restringida | Estados financieros previos, planes estratégicos, datos de salud | Lista nominal aprobada | Solo en plataformas autorizadas, con registro de acceso |

### Etiquetado
Los documentos confidenciales y restringidos deben llevar la etiqueta del nivel en el encabezado y en el nombre del archivo, por ejemplo `CONFIDENCIAL_contrato-proveedor.pdf`.

## 3. Cifrado
- Los discos de los portátiles corporativos están cifrados con BitLocker; no se debe desactivar.
- Los correos con información confidencial o restringida se envían cifrados.
- Los archivos que salen de la empresa por medios externos se cifran antes de enviarse.

Para cifrar un archivo con una clave simétrica y comprobar su integridad:

```bash
# Cifrar el archivo con AES-256
gpg --symmetric --cipher-algo AES256 informe.xlsx

# Calcular la huella para verificar que no se alteró
sha256sum informe.xlsx.gpg
```

La clave de cifrado nunca se envía por el mismo canal que el archivo.

## 4. Respaldos
La regla de respaldos es 3-2-1: tres copias de los datos, en dos tipos de medios distintos, con una copia fuera de la sede.

| Tipo | Frecuencia | Hora | Retención |
|---|---|---|---|
| Incremental | Diario | 2:00 a. m. | 35 días |
| Completo | Domingos | 11:00 p. m. | 12 meses |
| Archivo anual | Cada 31 de diciembre | 11:00 p. m. | 10 años |

Cada trimestre el equipo de infraestructura hace una prueba de restauración y documenta el tiempo que tardó. Un respaldo que nunca se ha restaurado se considera que no existe.

Ejemplo del script que verifica el respaldo del día:

```bash
#!/bin/bash
# Verifica que el respaldo incremental de hoy exista y pese más de 100 MB
ARCHIVO="/respaldos/incremental_$(date +%Y%m%d).tar.gz"
if [ -f "$ARCHIVO" ] && [ "$(stat -c%s "$ARCHIVO")" -gt 104857600 ]; then
  echo "OK: respaldo del día encontrado"
else
  echo "ALERTA: respaldo incompleto o inexistente" >&2
  exit 1
fi
```

## 5. Control de accesos
- Principio del mínimo privilegio: cada persona recibe solo los permisos que necesita para su cargo.
- Los permisos se revisan dos veces al año, en enero y en julio. El jefe directo confirma o retira cada acceso.
- Cuando una persona se retira, sus cuentas se desactivan el mismo día de su salida.
- Las llaves de API y los secretos de las aplicaciones se rotan cada 180 días y nunca se guardan en el código fuente.

Consulta de ejemplo para detectar cuentas que no se han usado en los últimos 90 días:

```sql
SELECT usuario, ultimo_acceso
  FROM auditoria_accesos
 WHERE ultimo_acceso < now() - interval '90 days'
 ORDER BY ultimo_acceso;
```

## 6. Eventos de seguridad
Un evento de seguridad es cualquier situación que pone en riesgo la información: un correo sospechoso, un equipo extraviado, un acceso no autorizado o una fuga de datos.

### Cómo reportar
Todo evento se reporta de inmediato a seguridad@acme.example o con el botón "Reportar phishing" del correo. No se debe intentar investigar por cuenta propia ni borrar evidencia.

### Clasificación y tiempos
| Gravedad | Descripción | Contención | Notificación a la gerencia |
|---|---|---|---|
| Leve | Un evento sin pérdida de datos, como un correo de phishing no abierto | 1 día hábil | En el informe mensual |
| Moderada | Un acceso indebido sin exposición confirmada de datos | 8 horas | Dentro de 24 horas |
| Grave | Exposición de datos confidenciales o interrupción de servicios | 2 horas | De inmediato |

Después de contener un evento grave, el oficial de seguridad entrega un informe con las causas y las acciones correctivas en un máximo de 5 días hábiles.

## 7. Dispositivos y medios
- Los dispositivos USB de almacenamiento están bloqueados. Para usarlos se necesita autorización previa con el formulario SG-04.
- No se permite conectar equipos personales a la red interna; para eso existe la red de invitados.
- No se instala software no autorizado. Las solicitudes pasan por soporte técnico.
- Los equipos desatendidos se bloquean con la tecla de Windows más L.

## 8. Correo y navegación
Para reconocer un correo de phishing, revisa:

1. Que el remitente corresponda al dominio real de la empresa.
2. Que no genere urgencia ni amenace con cerrar una cuenta.
3. Que los enlaces, al pasar el cursor, no apunten a direcciones extrañas.
4. Que no solicite credenciales ni abrir adjuntos inesperados.

Ante la duda, no hagas clic; reenvía el correo a seguridad@acme.example.

## 9. Registros de actividad
Los registros de acceso a los sistemas críticos se conservan 12 meses. Los registros de cámaras de seguridad se conservan 30 días. Nadie debe modificar ni borrar estos registros fuera de los procedimientos autorizados.

## 10. Responsabilidades
| Rol | Responsabilidad |
|---|---|
| Empleado | Cumplir esta guía y reportar eventos de inmediato |
| Jefe directo | Revisar los accesos de su equipo dos veces al año |
| Oficial de seguridad | Mantener la guía, investigar eventos y dar capacitación |
| Gerencia | Aprobar los recursos y atender los eventos graves |

El incumplimiento de esta guía puede dar lugar a medidas disciplinarias, según el reglamento interno de trabajo.

## 11. Casos prácticos

### Caso 1: un correo del "presidente"
Llega un correo, aparentemente del presidente de la empresa, que pide hacer una transferencia urgente y mantenerlo en secreto. Es un fraude conocido. No se responde ni se hace ninguna transferencia; se reenvía el correo a seguridad@acme.example. La gravedad es leve si nadie actuó, y moderada si alguien respondió con información.

### Caso 2: enviar un contrato a un cliente
Un contrato con tarifas es información confidencial. Debe enviarse por un canal cifrado y la clave debe entregarse por otro medio, por ejemplo por teléfono. El archivo lleva la etiqueta CONFIDENCIAL en el nombre. No se envía por WhatsApp personal ni se sube a un servicio de almacenamiento no autorizado.

### Caso 3: un USB encontrado
Una persona encuentra un USB en el parqueadero. No debe conectarlo a ningún equipo. Debe entregarlo al área de seguridad, porque puede contener software malicioso. Los dispositivos USB propios requieren la autorización SG-04.

### Caso 4: una persona se retira de la empresa
El mismo día de su salida, el jefe directo avisa a soporte técnico para desactivar las cuentas, y la persona entrega equipo y credenciales. Seguridad verifica en la siguiente revisión de accesos que ninguna cuenta quedó activa.

## 12. ¿Cómo comparto esta información?
| Si la información es... | Por correo corporativo | Por mensajería instantánea | Fuera de la empresa |
|---|---|---|---|
| Pública | Sí | Sí | Sí |
| Interna | Sí | Solo canales corporativos | Con autorización del jefe |
| Confidencial | Solo cifrada | No | Cifrada y con acuerdo de confidencialidad |
| Restringida | No, solo plataforma autorizada | No | Solo con aprobación del oficial de seguridad |

## 13. Retención de documentos
| Tipo de documento | Se conserva |
|---|---|
| Contratos con clientes y proveedores | 10 años después de terminados |
| Facturas y soportes contables | 10 años |
| Correos de trabajo | 3 años |
| Actas de comités | 5 años |
| Borradores y archivos temporales | Hasta 6 meses |

## 14. Glosario
| Término | Significado |
|---|---|
| Phishing | Engaño por correo o mensaje para obtener credenciales o dinero |
| MFA | Verificación en dos pasos para entrar a una cuenta |
| Cifrado simétrico | Cifrado en el que la misma clave cifra y descifra |
| Huella (hash) | Resumen único de un archivo que cambia si se altera |
| Mínimo privilegio | Dar solo los permisos que la persona necesita |
| Regla 3-2-1 | Tres copias, dos medios distintos, una fuera de la sede |
| Contención | Acciones para impedir que un evento siga creciendo |
