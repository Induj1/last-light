# Serial protocol

USB serial, **115200 baud, 8 data bits, no parity, 1 stop bit**. One LF-terminated ASCII record per message; CRLF is accepted. Node owns time, simulation, scoring, and reserve. Arduino owns only physical I/O.

## Arduino → Node: 25 Hz

```json
{"joystickX":512,"joystickY":508,"potentiometer":734,"button":false}
```

All three readings are integer ADC counts 0–1023. `button` is a boolean: true means pressed after debouncing. Hardware readings are lightly smoothed before transmission. Centering, deadzone, direction, and knob endpoint calibration are applied by Node. A button press is an edge-triggered start/confirm input; no extra power button is needed to stabilize a targeted building.

Node maps the calibrated knob travel into three equal zones: **LOW**, **MEDIUM**, and **HIGH**. There is no OFF setting. At the boundaries, a three-percentage-point hysteresis margin prevents small ADC fluctuations from changing the selected mode. A rapid full sweep can move directly from LOW to HIGH or back. Calibration, disconnect, and stale-input recovery reset the remembered zone. The analog firmware packet is unchanged.

The browser/server command is `{ "type": "power", "mode": "low" }`, with `medium` and `high` as the other accepted modes. Numeric power commands are rejected. The simulation uses canonical levels 35, 60, and 85 internally; those values are not continuously adjustable power settings. Keyboard increase/decrease input steps through the same modes.

The backend ignores malformed records and stale input, and switches the UI to keyboard mode when the link is lost. Reconnect resumes hardware control once valid packets arrive. Do not send log strings on the same serial stream. Close Arduino Serial Monitor before connecting the game.

## Node → Arduino

```text
STORAGE:73
TEST:50
LCD:TIME 42s HIGH|STORAGE 73%
```

`STORAGE:n` uses an integer from 0 through 100 and is sent at most ten times per second. `TEST:n` uses the same syntax and LED renderer; the organizer server restores live storage after its temporary override. The firmware accepts only digits within range, rejecting signed, decimal, trailing-junk, empty, or overflowing values. Values are percentages regardless of the configured segment count. Quantization rounds upward to a lit segment while reserve remains positive.

`LCD:line1|line2` is optional. Text is printable ASCII; each line is truncated/padded to 16 characters. Use no `|` inside a row. LCD commands are ignored when the LCD build option is disabled. Node updates text no faster than 1 Hz.

The firmware receive buffer allows **79 payload bytes** plus a NUL terminator. An overlong line is dropped until its newline, then parsing recovers. At most 32 incoming bytes are processed in each loop iteration so a malformed stream cannot monopolize physical input sampling. Transmit writes use the UART's available buffer space and never wait for a complete packet to fit. There are no line-read timeouts or `delay()` calls in the game I/O loop.

LED outputs start blank, change when the host sends reserve, and blank after **5 seconds without a valid STORAGE/TEST command**. The host sends the initial full reserve after connecting. No acknowledgement is emitted: Node tracks controller health from the input packet stream, and physical LED testing verifies the output direction.
