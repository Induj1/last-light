# Build the physical controller

For a first build, follow [BUILD-CONTROLLER.md](BUILD-CONTROLLER.md) and the printable circuit in [wiring.svg](wiring.svg). The ready-to-upload sketch is `arduino/LastLight/LastLight.ino`; the controller download ZIP contains the same sketch in `LastLight/LastLight.ino`.

**Use the local game for Arduino control.** This project's public Vercel page does not open a USB serial port and cannot use the Arduino controller. Run the full project locally with Node.js, open `http://127.0.0.1:3001`, and connect the COM port in Organizer → Controller. The local game and its scores are separate from the hosted public event.

The existing LED bar has not yet been identified. The firmware therefore ships with its LED driver **disabled**. The whole game runs now using the keyboard, mouse, and on-screen storage bar. Connect the joystick and knob first; select a physical LED adapter only after checking the bar's model, supply, pinout, polarity, and current requirements.

This guide targets an **Arduino UNO R3 / ATmega328P, 5 V**. Other boards require checking their voltage and ADC range. The UNO R3 has six 10-bit analog inputs, which report 0–1023. Arduino's official pinout lists **20 mA maximum per I/O pin**; the bare LED options below use about 1–2 mA per segment. [Arduino UNO documentation](https://docs.arduino.cc/hardware/uno-rev3/), [official UNO R3 pinout](https://docs.arduino.cc/resources/pinouts/A000066-full-pinout.pdf).

## Parts and core connections

Use a USB data cable, 5 V-compatible two-axis analog joystick, a **10 kΩ linear potentiometer** with a large knob, breadboard or secured terminals, and jumper wires. A pushbutton between D2 and GND can substitute for the joystick switch. Disconnect USB while changing wiring. Use only this low-voltage controller circuit; no real loads or mains wiring are involved.

Use the UNO's labelled **5V output**, not VIN or the 3.3V pin, for these verified 5 V parts. All GND connections are common. If a breadboard power rail is split in the middle, bridge the matching halves deliberately; do not assume a continuous rail. The USB cable is the only power source for this baseline build. The diagram shows electrical connections, not the physical order of pins on an unidentified module.

| Part signal | UNO R3 connection | Notes |
|---|---|---|
| Joystick VCC / +5V | 5V | Verify the module's label; do not infer connector order |
| Joystick GND | GND | Shared ground |
| Joystick VRx | A0 | X-axis wiper |
| Joystick VRy | A1 | Y-axis wiper |
| Joystick SW | D2 | Switch closes to GND; `INPUT_PULLUP` |
| Potentiometer outer terminal | 5V | Swap the outer wires if rotation feels reversed |
| Potentiometer other outer terminal | GND | Do not use the wiper as a power terminal |
| Potentiometer middle / wiper | A2 | 0–1023 raw input |
| USB | Laptop | Serial data and low-current controller power |

With `INPUT_PULLUP`, the switch reads HIGH when released and LOW when pressed. Firmware reports a debounced boolean `true` for pressed. [Arduino input pull-up tutorial](https://docs.arduino.cc/tutorials/generic/digital-input-pullup/).

Open [wiring.svg](wiring.svg) in a browser and print landscape. Match the actual labels on each part. The normal potentiometer remains analog in the sketch: the local Node bridge converts its calibrated travel into **LOW / MEDIUM / HIGH**, with no OFF position. A three-position switch is not a drop-in replacement for the documented 10 kΩ potentiometer.

## Choose an LED adapter

Edit the switches at the top of `arduino/LastLight/LastLight.ino`, then upload again. `LASTLIGHT_LED_MODE` is a build setting; selecting a COM port does not select the hardware type.

| Mode | Use only with | Pins | Capacity |
|---|---|---|---|
| `0` / disabled (default) | Unknown module, or keyboard testing | No LED pins driven | On-screen bar works |
| `1` / direct | Verified bare individually accessible low-current LED segments | D3 through D12 | 1–10 segments |
| `2` / two 74HC595s | Verified bare segments plus the two-chip circuit below | D3 data, D4 clock, D5 latch, D6 enable | 1–16 segments |

`LASTLIGHT_LED_SEGMENTS` defaults to 10. The display lights `ceil(storage × segments / 100)` segments: 0% is off, 100% is full, and any positive reserve retains at least one segment. `LASTLIGHT_LED_ACTIVE_LOW` defaults to `0`; set it to `1` only for a verified common-anode/sinking circuit. Each branch still needs its own series resistor.

A bar marked **MY9221 / Grove**, **WS2812 / addressable RGB**, **TM1637**, **MAX7219**, or another driver is not interchangeable with either bare LED circuit. Keep mode 0 while identifying it, and add its manufacturer-supported driver inside `writeStorageBar()` / `setupStorageBar()`. An LED module's appearance or number of pins does not establish its protocol. No driver for those modules is implied by this project.

### Mode 1: individual segments

For the documented active-HIGH circuit, connect each UNO output through a **2.2 kΩ resistor** to one verified LED anode; connect its cathode to GND. D3 is segment 1 (first to light), D4 is segment 2, through D12 segment 10. Never use one shared resistor for the whole bar. Start with 2.2 kΩ: at 5 V and a typical red forward voltage near 2 V, current is approximately `(5 − 2) / 2200 = 1.36 mA` per segment. Actual brightness and forward voltage depend on the LED. Verify the part's ratings before any change.

Bare bars may have independent pins, a common anode, or a common cathode; determine this from the datasheet or a multimeter's diode test before wiring. For a verified common-anode bar, connect the common anode to 5V and each cathode via its own resistor to its output, then set active-LOW. A high-current or higher-voltage bar needs its proper external driver and supply; it must not be powered by GPIO.

### Mode 2: two 74HC595 chips

This concrete option uses **two SN74HC595N 16-pin DIP chips at 5 V**. It does not assert that your existing bar already contains these chips. The chip nearest the Arduino is U1. Both chips share power, clocks, latch, and enable. Place a **100 nF ceramic bypass capacitor from pin 16 to pin 8 at each chip**. [Texas Instruments pinout and operating data](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf).

| Connection | U1 | U2 |
|---|---|---|
| 5V | Pin 16 VCC, pin 10 SRCLR | Pin 16 VCC, pin 10 SRCLR |
| GND | Pin 8 | Pin 8 |
| D3 data | Pin 14 SER | — |
| Cascaded serial | Pin 9 QH′ to U2 pin 14 | Pin 14 from U1 pin 9 |
| D4 clock | Pin 11 SRCLK | Pin 11 SRCLK |
| D5 latch | Pin 12 RCLK | Pin 12 RCLK |
| D6 output enable | Pin 13 OE | Pin 13 OE |
| Boot blanking | Shared OE line has **10 kΩ pull-up to 5V** | Same line |

Outputs QA–QH are pins **15, 1, 2, 3, 4, 5, 6, 7**, respectively. U1 QA–QH drive segments 1–8; U2 QA–QH drive segments 9–16. Connect each output through its own 2.2 kΩ resistor to an LED anode, with all cathodes at GND. Leave unused outputs open; do not ground them. U2 pin 9 is unused. Firmware shifts the upper byte first, then the lower byte, before latching. Enable remains HIGH until the initial all-off pattern has been loaded. [Arduino shifting tutorial](https://docs.arduino.cc/tutorials/communication/guide-to-shift-out/).

Use the component's recommended output operating current, not its absolute maximum rating, to size a different circuit. These low-current LED branches keep the output and chip totals modest; a 74HC595 is not a high-power LED driver. [TI datasheet](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf).

## Optional 16 × 2 LCD

The LCD is optional and disabled by default. This firmware supports a verified 5 V HD44780-compatible LCD with a supported I2C backpack, using **hd44780 by Bill Perry** (Library Manager), specifically `hd44780_I2Cexp`. Install that library before going offline if you want this option. The library supports backpack autodetection; an explicit known address can also be supplied. [Library source and supported constructors](https://github.com/duinoWitchery/hd44780/blob/master/hd44780ioClass/hd44780_I2Cexp.h).

Connect backpack GND→GND, VCC→5V, SDA→A4, SCL→A5 on UNO R3. Verify the backpack's voltage and connector labels first. Set `LASTLIGHT_LCD_ENABLED` to `1`; leave `LASTLIGHT_LCD_ADDRESS` at `0` to auto-detect a supported backpack or set its verified 7-bit address. It is not always `0x27`. Run the library's `I2CexpDiag` example and adjust the contrast trimmer before uploading LAST LIGHT. A bare parallel LCD requires a different wiring/driver adapter and is not covered by these four connections.

The server sends two short text rows. LCD updates are capped at 1 Hz to avoid flicker and keep inputs responsive. With a recent Arduino AVR core, firmware enables an I2C timeout and disables LCD writes after a bus timeout; controls and LEDs continue. A failed optional LCD is not a reason to stop the game.

## Upload and verify inputs

1. Install Arduino IDE and **Arduino AVR Boards** while you have internet. Open `arduino/LastLight/LastLight.ino`.
2. Keep LED mode 0 and LCD disabled for the first upload. Choose **Arduino Uno** and the connected COM port. Upload.
3. Open Serial Monitor at **115200 baud**, newline ending. Every 40 ms you should receive a complete JSON line, for example `{"joystickX":512,"joystickY":508,"potentiometer":734,"button":false}`. Center the joystick, sweep both axes, rotate the knob, and press the switch.
4. Close Serial Monitor completely. Only one program can own the port at a time.
5. Start the game. Open Organizer, refresh ports, select the correct COM port, and connect. Allow about two seconds for UNO auto-reset. The connection becomes live when valid packets arrive.
6. Finish the calibration below. Test a full keyboard round before and after hardware connection.

The sketch sends only JSON on its input stream; it does not mix debug text into packets. No core gameplay runs on the Arduino. You can upload from Arduino CLI as well: `arduino-cli compile --fqbn arduino:avr:uno arduino/LastLight`, then `arduino-cli upload -p COM4 --fqbn arduino:avr:uno arduino/LastLight` (use your port).

## Calibrate in Organizer

Pause the game while calibrating. Watch the **raw hardware values** in Organizer. All calibration belongs to Node, so reconnecting does not require reflashing.

1. Release the joystick. Record stable center X and Y (often near 512, but use the observed readings). Enter those centers.
2. Set deadzone initially to **80 ADC counts**. Increase it only if the cursor drifts at rest; lower it if aiming takes too much movement. Check the full board can be reached. If vertical travel is reversed, enable **Invert Y**. If horizontal travel is reversed, swap the joystick X potentiometer's supply ends only if accessible and correctly identified, or rotate/reorient the joystick module physically.
3. Turn the knob to its labelled LOW end. Record **Min pot**. Turn to the HIGH end and record **Max pot**; the readings must be distinct and ordered. If backwards, swap the potentiometer's two outer wires with USB disconnected.
4. Save calibration. Check the first third of knob travel selects **LOW**, the middle third selects **MEDIUM**, and the final third selects **HIGH**. There is no OFF setting. A small hysteresis margin around each boundary prevents chatter; slowly cross each boundary in both directions, then rest the knob and confirm the selected mode stays stable. Match the selected building's required mode to stabilize it.
5. Release the joystick, reconnect USB, and confirm there is no drift and the saved calibration remains active.

The server persists calibration locally. Calibrate again after replacing a joystick/potentiometer or changing mechanical orientation. Firmware lightly smooths ADC readings and debounces the switch for 25 ms; calibration must still use the observed values, not assumed ideal endpoints.

## Test the storage bar

After identifying and wiring a supported adapter, set the matching build mode and segment count, upload, and reconnect. In Organizer use LED test values **0, 25, 50, 75, 100**. Confirm segment 1 is nearest the zero end of the printed label and the entire bar lights at 100. The server temporarily overrides the displayed reserve for this test, then restores the current game reserve. A new round must show a full bar. If reserve reaches zero, the bar must be off. A city blackout caused by 27 failed buildings can end a round with reserve left: the physical bar correctly keeps showing that remaining reserve. It is a reserve display, not a count of buildings with lights on.

To isolate firmware from the game, close Node's serial connection, open Serial Monitor at 115200 with newline, and send `TEST:0`, `TEST:50`, then `TEST:100`. `STORAGE:n` uses the same percentage renderer. With ten segments, 50 lights five. Without a fresh storage or test command for five seconds, firmware blanks the bar, so a lost host connection cannot leave a misleading full reserve. Send another command to restore it. The onboard D13 indicator shows a fresh host storage link, not game success.

Check the exact driver selection whenever a bar remains dark: mode 0 intentionally never drives LED pins. Do not try random pin mappings or larger currents to identify unknown hardware.
