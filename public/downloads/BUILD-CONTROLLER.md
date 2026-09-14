# Build your LAST LIGHT controller

Start with **one Arduino Uno R3, one analog joystick, and one 10 kΩ linear potentiometer**. That is enough to play with physical controls. The sketch is ready to upload with the optional LED bar and LCD disabled.

**Open the sketch:** in the controller ZIP, open `LastLight/LastLight.ino`. In the full game project, open `arduino/LastLight/LastLight.ino`. Keep the `.ino` file inside its `LastLight` folder.

**Open the circuit:** [wiring.svg](wiring.svg). It is a printable electrical wiring diagram; the module boxes do not indicate the physical order of pins.

## 1. Gather the parts

| Quantity | Part | What to choose |
|---|---|---|
| 1 | Arduino Uno R3 | ATmega328P, 5 V, with a USB data cable suitable for its USB connector |
| 1 | Two-axis analog joystick module | Labelled VCC/+5V, GND, VRx, VRy, SW; verify it supports 5 V |
| 1 | 10 kΩ linear potentiometer + knob | Three terminals; confirm which is the wiper |
| 1 | Breadboard | Check whether its power rails are split |
| About 20 | Jumper wires | Correct male/female ends for your modules |
| Optional | Momentary normally-open pushbutton | Only needed if your joystick has no press switch |
| Optional | Ten individual indicator LEDs | Known polarity and low-current ratings; these can form a simple reserve bar |
| 10 if using LEDs | 2.2 kΩ resistors, ¼ W | One resistor for every LED; never one shared resistor |
| Optional | 16 × 2 HD44780 LCD with supported I2C backpack | Verified 5 V module; requires the optional library and firmware switch below |

The existing LED bar's model is unknown, so **leave it disconnected for the first build**. Ten separate LEDs are a supported alternative. Do not infer a bar's pinout from its shape or assume an addressable module is a bare LED array.

## 2. Wire the basic controller with USB unplugged

Connect the Uno's **5V** output to the breadboard positive rail and **GND** to the ground rail. Use those rails for the joystick and potentiometer. Every ground in the circuit must join the Uno's GND. Leave VIN, 3.3V, AREF, D0, and D1 unconnected in this build.

| From | To | Purpose |
|---|---|---|
| Joystick VCC / +5V | Uno 5V rail | Joystick supply |
| Joystick GND | Uno GND rail | Shared reference |
| Joystick VRx | Uno A0 | Horizontal movement |
| Joystick VRy | Uno A1 | Vertical movement |
| Joystick SW | Uno D2 | Press action; switch closes to GND |
| Pot outer terminal 1 | Uno 5V rail | One end of knob travel |
| Pot outer terminal 2 | Uno GND rail | Other end of knob travel |
| Pot wiper / usual middle terminal | Uno A2 | Knob reading |
| Uno USB | Computer USB | Power and serial data |

The D2 switch uses the Uno's internal pull-up. It is HIGH when released and LOW when pressed; no external button resistor is needed for this simple circuit. If using a separate button, wire it between **D2 and GND**. On a four-leg tactile button, use contacts that are open when released and connected when pressed; verify the pairs. [Arduino pull-up example](https://docs.arduino.cc/built-in-examples/digital/InputPullupSerial/).

This is a **5 V Uno R3** design. Do not connect 5 V signals to a different board without checking that board's limits. The baseline is powered only by USB; do not add a battery or external supply. Arduino documents the Uno's USB power and labelled power/analog connectors in its [Uno R3 manual](https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf). The potentiometer arrangement follows Arduino's [AnalogReadSerial example](https://github.com/arduino/arduino-examples/blob/main/examples/01.Basics/AnalogReadSerial/AnalogReadSerial.ino).

Before plugging in USB, check that 5V and GND are not accidentally joined, the potentiometer wiper goes only to A2, and no bare leads touch neighbouring terminals. Never move wires while powered.

## 3. Upload the supplied Arduino code

1. Install [Arduino IDE](https://www.arduino.cc/en/software/) and the **Arduino AVR Boards** package while online.
2. Open the supplied `LastLight.ino` sketch. Leave these settings at the top unchanged for the first test:

```cpp
#define LASTLIGHT_LED_MODE 0
#define LASTLIGHT_LED_SEGMENTS 10
#define LASTLIGHT_LED_ACTIVE_LOW 0
#define LASTLIGHT_LCD_ENABLED 0
```

3. Connect the Uno with a **data-capable** USB cable. Select **Arduino Uno** and its actual COM port in the IDE, then click **Upload**. No additional library is required for the basic controller.
4. Open Serial Monitor at **115200 baud**. You should see one JSON line every 40 ms, similar to:

```json
{"joystickX":512,"joystickY":508,"potentiometer":734,"button":false}
```

5. Move the stick, turn the knob, and press/release the stick. The three readings should vary within 0–1023; `button` should become `true` while pressed. The Uno's ADC supplies those raw values; the computer performs calibration and chooses the three power modes.
6. **Close Serial Monitor before connecting the game.** The IDE and Node cannot use the same serial port together.

Optional Arduino CLI commands, from the full project folder:

```text
arduino-cli compile --fqbn arduino:avr:uno arduino/LastLight
arduino-cli upload --fqbn arduino:avr:uno -p COM4 arduino/LastLight
```

Replace `COM4` with your board's port. These commands compile/upload only when you run them; no board was flashed while preparing this package.

## 4. Start the local game and connect it

**The public Vercel website does not read this Arduino.** Its online play uses browser controls. To use USB hardware, run the full LAST LIGHT project on the same computer as the Uno. The controller ZIP contains firmware and build instructions, not the complete Node game.

Install Node.js 22 LTS, then open PowerShell in the full game folder containing `package.json`:

```powershell
npm install
npm run build
npm start
```

Open **http://127.0.0.1:3001**. The terminal must remain running. Dependency installation needs internet once; normal local play needs no CDN, web fonts, or online audio. On Windows, the full project's `scripts/start-exhibition.ps1` is an alternative launcher.

Open **Organizer → Controller**, refresh ports, choose the Uno's COM port, and click **Connect**. Allow about two seconds for the Uno to reset and begin sending packets. You should see the raw hardware values update. If Organizer has no Controller tab, you have opened the public hosted page instead of the local game.

Click or press a key in the game browser once during setup to enable audio before hardware-only play. Local event scores are stored on that computer and are separate from the public online leaderboard.

## 5. Calibrate and label LOW / MEDIUM / HIGH

1. Leave the joystick at rest. In Organizer, use **Capture resting centre** or enter its observed center X/Y values. Start with a deadzone of **80**.
2. Turn the knob fully to its LOW end and enter the observed **KNOB MINIMUM**. Turn fully to HIGH and enter **KNOB MAXIMUM**. They must be ordered and at least 100 ADC counts apart.
3. Click **Save calibration**, close Organizer, then start or resume practice. Calibration edits do not apply until saved, and the cursor does not move while Organizer pauses the game.
4. In practice, check all map directions and turn the knob through **LOW**, **MEDIUM**, and **HIGH**. The local bridge maps roughly the first third of travel to LOW, the middle third to MEDIUM, and the last third to HIGH. A small hysteresis band makes the boundaries stable. There is no OFF position and no need to label percentages on the knob.
5. If adjustments are needed, reopen Organizer. Increase deadzone only if the cursor drifts while released; use **Invert Y** if vertical movement is reversed. Reorient the joystick physically if horizontal direction is reversed; do not swap the module's VCC and GND pins. If the knob runs backwards, unplug USB and swap **only the potentiometer's two outer wires**; leave its wiper at A2. Reconnect and measure its endpoints again. Save calibration, close Organizer, and repeat the practice check.
6. Place LOW / MEDIUM / HIGH marks on the panel using the actual on-screen changes. A continuous potentiometer is expected; a three-position switch is not the same circuit.

Use the guided practice: select the highlighted homes, choose **MEDIUM**, keep the connection matched, then choose **LOW**. Press the joystick button after practice completes to start a scored shift. During a live shift, connections secure automatically while the selected service receives enough power; the joystick button does not pause or reset the game. At ready/results it enters practice; when paused it resumes. The first movement or press during the idle demo only wakes the game.

## 6. Add a known LED reserve bar later

The easiest supported bar uses **ten separate LEDs**. Keep USB unplugged while adding them.

For each branch, wire **Uno output → 2.2 kΩ resistor → LED anode**, then **LED cathode → GND**. For separate through-hole LEDs, identify polarity from their datasheet/markings or diode test; trimmed leads can make length unreliable. Do not apply these pin assumptions to an unidentified bar module.

| LED / segment | Uno output | Series resistor |
|---|---|---|
| 1, first to light | D3 | 2.2 kΩ |
| 2 | D4 | 2.2 kΩ |
| 3 | D5 | 2.2 kΩ |
| 4 | D6 | 2.2 kΩ |
| 5 | D7 | 2.2 kΩ |
| 6 | D8 | 2.2 kΩ |
| 7 | D9 | 2.2 kΩ |
| 8 | D10 | 2.2 kΩ |
| 9 | D11 | 2.2 kΩ |
| 10, last to light | D12 | 2.2 kΩ |

Set `LASTLIGHT_LED_MODE` to **1**, keep ten segments and active-LOW at **0**, and upload again. Arduino's official Uno pinout lists 20 mA maximum per I/O pin. At 5 V and an LED forward voltage of about 2 V, a 2.2 kΩ resistor gives about **1.36 mA**, or **13.6 mA for ten LEDs**. Actual LED voltage and brightness vary. These resistors intentionally keep the indicator current low; do not use GPIO to power large LED strips. [Official Uno R3 pinout and limit](https://docs.arduino.cc/resources/pinouts/A000066-full-pinout.pdf).

In Organizer, test **0 / 25 / 50 / 75 / 100**. A ten-LED bar should show **0 / 3 / 5 / 8 / 10** lit segments. The test lasts three seconds, then returns to current reserve. A five-second loss of valid host storage commands blanks the bar. The bar shows stored energy: a 27-building blackout may end a shift while some reserve remains.

The sketch also supports **two SN74HC595N chips** and known bare LED segments. This is an alternative to direct mode and uses different wiring. Full pin tables, active-LOW variants, and the optional LCD setup are in [HARDWARE.md](HARDWARE.md). Addressable RGB, MY9221, TM1637, and MAX7219 modules need their own supported driver; they are not enabled by selecting mode 1 or 2.

## Optional I2C LCD

For a verified 5 V HD44780-compatible 16 × 2 LCD with a supported I2C backpack: **VCC → 5V, GND → GND, SDA → A4, SCL → A5**. Install **hd44780 by Bill Perry** using Library Manager; run its `I2CexpDiag` example first. Set `LASTLIGHT_LCD_ENABLED` to **1**. Address **0** means supported-backpack autodetection; do not assume every display uses `0x27`. This is not the wiring for a bare parallel LCD. [Library's I2C backpack implementation](https://github.com/duinoWitchery/hd44780/blob/master/hd44780ioClass/hd44780_I2Cexp.h).

The local game sends time/power mode on the first line and reserve on the second. The LCD is optional; leave it disabled while testing the basic controller.

## Quick troubleshooting

| What you see | Check next |
|---|---|
| No COM port | Use a data cable, another USB port, and the board vendor's official USB driver if required |
| Upload or Connect says port busy | Close Serial Monitor and disconnect any other program using that port |
| JSON is unreadable | Set Serial Monitor to 115200 baud |
| Axis or knob sticks at 0/1023 | Unplug USB; verify shared GND, 5V, and the correct wiper/signal pin |
| Pointer drifts | Measure the actual resting center; increase deadzone slightly |
| Wrong knob direction | Unplug USB; swap the pot's outer wires only, then recalibrate |
| LED bar stays dark | Default mode 0 intentionally disables it; verify the known circuit before mode 1 |
| Game switches to keyboard | Serial data has been stale for more than one second; check cable/port and reconnect |
| No Controller tab | Open the local page at 127.0.0.1:3001, not the hosted Vercel game |

## Verification and remaining physical checks

Checked on 13 September 2026 with Arduino AVR Boards 1.8.8 and the official AVR toolchain; LCD build used hd44780 1.3.2:

| Actual Uno-target compile | Flash / 32,256 bytes | Static RAM / 2,048 bytes | Result |
|---|---|---|---|
| Default controller; LED/LCD disabled | 4,894 | 489 | Passed |
| Direct ten-LED mode | 5,094 | 500 | Passed |
| Two 74HC595s; 16 segments; I2C LCD enabled | 10,808 | 870 | Passed |

Five compiled host-side firmware configurations also passed their assertions for packet framing, malformed/oversized input recovery, LED mapping, button debounce, serial backpressure, and timeout blanking. The current server/firmware interface was checked against the three-mode game. These are software checks using simulated I/O plus actual AVR compilation, not electrical or physical performance measurements.

**No physical Uno, joystick, LED bar, or LCD was connected or flashed for these checks.** Before exhibition use, verify polarity, rail continuity, stable LOW/MEDIUM/HIGH selection, all map directions, reconnect behavior, and a complete practice plus scored shift on the real controller.
