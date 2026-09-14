/*
 * LAST LIGHT — Arduino UNO R3 physical I/O only.
 * Read docs/HARDWARE.md before enabling an LED adapter.
 * Build instructions: docs/BUILD-CONTROLLER.md (UNO R3, USB, joystick + 10k pot).
 * The local Node bridge maps the knob to LOW / MEDIUM / HIGH after calibration.
 * The public Vercel page does not connect to this USB serial controller.
 * The actual user's LED module has NOT been identified; mode 0 is intentional.
 * No dynamic String allocation, delays, or game rules are used here.
 */
#include <Arduino.h>
#include <stdio.h>
#include <string.h>

// Build switches can also be supplied as compiler -D flags for verification.
#ifndef LASTLIGHT_LED_MODE
#define LASTLIGHT_LED_MODE 0       // 0=disabled, 1=bare direct LEDs, 2=two 74HC595s
#endif
#ifndef LASTLIGHT_LED_SEGMENTS
#define LASTLIGHT_LED_SEGMENTS 10
#endif
#ifndef LASTLIGHT_LED_ACTIVE_LOW
#define LASTLIGHT_LED_ACTIVE_LOW 0 // Only for a verified common-anode/sinking circuit
#endif
#ifndef LASTLIGHT_LCD_ENABLED
#define LASTLIGHT_LCD_ENABLED 0
#endif
#ifndef LASTLIGHT_LCD_ADDRESS
#define LASTLIGHT_LCD_ADDRESS 0    // 0=hd44780_I2Cexp autodetect; else verified 7-bit address
#endif

#if LASTLIGHT_LED_MODE < 0 || LASTLIGHT_LED_MODE > 2
#error Unsupported LED mode. Identify the module before writing a new adapter.
#endif
#if LASTLIGHT_LED_SEGMENTS < 1 || LASTLIGHT_LED_SEGMENTS > 16
#error LED segment count must be between 1 and 16.
#endif
#if LASTLIGHT_LED_MODE == 1 && LASTLIGHT_LED_SEGMENTS > 10
#error Direct LED mode supports at most 10 segments on pins D3 through D12.
#endif

#if LASTLIGHT_LCD_ENABLED
#include <Wire.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>
hd44780_I2Cexp lcd((uint8_t)LASTLIGHT_LCD_ADDRESS);
bool lcdReady = false;
bool lcdDirty = false;
char lcdRows[2][17] = { "LAST LIGHT      ", "WAITING FOR HOST" };
unsigned long lastLcdAt = 0;
#endif

const uint8_t JOYSTICK_X = A0;
const uint8_t JOYSTICK_Y = A1;
const uint8_t POWER_KNOB = A2;
const uint8_t BUTTON_PIN = 2;
const uint8_t LINK_LED = 13;
const uint8_t LED_PINS[10] = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };
const uint8_t SHIFT_DATA = 3;
const uint8_t SHIFT_CLOCK = 4;
const uint8_t SHIFT_LATCH = 5;
const uint8_t SHIFT_ENABLE = 6; // Both OE pins; external 10k pull-up keeps boot blank
const unsigned long SAMPLE_INTERVAL_MS = 5;
const unsigned long PACKET_INTERVAL_MS = 40;
const unsigned long BUTTON_DEBOUNCE_MS = 25;
const unsigned long HOST_TIMEOUT_MS = 5000;

unsigned long lastSampleAt = 0;
unsigned long lastPacketAt = 0;
unsigned long buttonChangedAt = 0;
unsigned long lastHostAt = 0;
bool rawButton = false;
bool stableButton = false;
bool hostActive = false;
int32_t filteredX = 0;
int32_t filteredY = 0;
int32_t filteredPot = 0;
uint8_t storageValue = 0;

char receiveBuffer[80];
uint8_t receiveLength = 0;
bool droppingLine = false;
char transmitBuffer[100];
uint8_t transmitLength = 0;
uint8_t transmitOffset = 0;

void writeStorageBar(uint8_t percentage) {
  const uint8_t count = (uint16_t(percentage) * LASTLIGHT_LED_SEGMENTS + 99) / 100;
#if LASTLIGHT_LED_MODE == 1
  for (uint8_t segment = 0; segment < LASTLIGHT_LED_SEGMENTS; segment++) {
    const bool on = segment < count;
    digitalWrite(LED_PINS[segment], (on != bool(LASTLIGHT_LED_ACTIVE_LOW)) ? HIGH : LOW);
  }
#elif LASTLIGHT_LED_MODE == 2
  uint16_t pattern = count == 16 ? uint16_t(0xFFFF) : uint16_t((uint32_t(1) << count) - 1);
  if (LASTLIGHT_LED_ACTIVE_LOW) pattern = uint16_t(~pattern);
  digitalWrite(SHIFT_LATCH, LOW);
  // Far chip U2 receives high byte; near chip U1 receives low byte.
  shiftOut(SHIFT_DATA, SHIFT_CLOCK, MSBFIRST, uint8_t(pattern >> 8));
  shiftOut(SHIFT_DATA, SHIFT_CLOCK, MSBFIRST, uint8_t(pattern & 0xFF));
  digitalWrite(SHIFT_LATCH, HIGH);
#else
  (void)count; // Deliberately do not drive unknown LED hardware.
#endif
}

void setupStorageBar() {
#if LASTLIGHT_LED_MODE == 1
  for (uint8_t segment = 0; segment < LASTLIGHT_LED_SEGMENTS; segment++) {
    // Set the inactive level before enabling the pin as an output.
    digitalWrite(LED_PINS[segment], LASTLIGHT_LED_ACTIVE_LOW ? HIGH : LOW);
    pinMode(LED_PINS[segment], OUTPUT);
  }
#elif LASTLIGHT_LED_MODE == 2
  digitalWrite(SHIFT_ENABLE, HIGH);
  pinMode(SHIFT_ENABLE, OUTPUT);
  digitalWrite(SHIFT_DATA, LOW);
  digitalWrite(SHIFT_CLOCK, LOW);
  digitalWrite(SHIFT_LATCH, LOW);
  pinMode(SHIFT_DATA, OUTPUT);
  pinMode(SHIFT_CLOCK, OUTPUT);
  pinMode(SHIFT_LATCH, OUTPUT);
  writeStorageBar(0);
  digitalWrite(SHIFT_ENABLE, LOW);
#endif
}

bool parsePercentage(const char *source, uint8_t &value) {
  if (!source[0]) return false;
  uint16_t parsed = 0;
  for (uint8_t i = 0; source[i]; i++) {
    if (source[i] < '0' || source[i] > '9' || i >= 3) return false;
    parsed = parsed * 10 + uint8_t(source[i] - '0');
    if (parsed > 100) return false;
  }
  value = uint8_t(parsed);
  return true;
}

#if LASTLIGHT_LCD_ENABLED
void copyLcdRow(char *destination, const char *source) {
  uint8_t column = 0;
  while (*source && *source != '|' && column < 16) {
    const char character = *source++;
    destination[column++] = character >= 32 && character <= 126 ? character : ' ';
  }
  while (column < 16) destination[column++] = ' ';
  destination[16] = '\0';
}

void refreshLcd(unsigned long now) {
  if (!lcdReady || !lcdDirty || now - lastLcdAt < 1000) return;
  lastLcdAt = now;
  lcdDirty = false;
  for (uint8_t row = 0; row < 2; row++) {
    lcd.setCursor(0, row);
    lcd.print(lcdRows[row]);
#if defined(WIRE_HAS_TIMEOUT)
    if (Wire.getWireTimeoutFlag()) {
      Wire.clearWireTimeoutFlag();
      lcdReady = false; // Missing optional display must not repeatedly stall input.
      return;
    }
#endif
  }
}
#endif

void acceptHostLine(char *line, unsigned long now) {
  const char *number = nullptr;
  if (strncmp(line, "STORAGE:", 8) == 0) number = line + 8;
  else if (strncmp(line, "TEST:", 5) == 0) number = line + 5;
  if (number) {
    uint8_t value;
    if (!parsePercentage(number, value)) return;
    if (!hostActive || value != storageValue) writeStorageBar(value);
    storageValue = value;
    lastHostAt = now;
    hostActive = true;
    digitalWrite(LINK_LED, HIGH);
    return;
  }
#if LASTLIGHT_LCD_ENABLED
  if (strncmp(line, "LCD:", 4) == 0 && lcdReady) {
    const char *first = line + 4;
    const char *separator = strchr(first, '|');
    copyLcdRow(lcdRows[0], first);
    copyLcdRow(lcdRows[1], separator ? separator + 1 : "");
    lcdDirty = true;
  }
#endif
}

void readHost(unsigned long now) {
  uint8_t budget = 32;
  while (budget-- && Serial.available() > 0) {
    const char character = char(Serial.read());
    if (character == '\n') {
      if (!droppingLine && receiveLength > 0) {
        if (receiveBuffer[receiveLength - 1] == '\r') receiveLength--;
        receiveBuffer[receiveLength] = '\0';
        acceptHostLine(receiveBuffer, now);
      }
      receiveLength = 0;
      droppingLine = false;
    } else if (!droppingLine) {
      if (receiveLength >= sizeof(receiveBuffer) - 1 || character == '\0') {
        droppingLine = true;
        receiveLength = 0;
      } else receiveBuffer[receiveLength++] = character;
    }
  }
}

void sampleControls(unsigned long now) {
  const bool pressed = digitalRead(BUTTON_PIN) == LOW;
  if (pressed != rawButton) { rawButton = pressed; buttonChangedAt = now; }
  if (now - buttonChangedAt >= BUTTON_DEBOUNCE_MS) stableButton = rawButton;
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;
  // Fixed-point EMA: smooth electrical noise without calibrating away raw endpoints.
  filteredX += int32_t(analogRead(JOYSTICK_X)) - filteredX / 8;
  filteredY += int32_t(analogRead(JOYSTICK_Y)) - filteredY / 8;
  filteredPot += int32_t(analogRead(POWER_KNOB)) - filteredPot / 8;
}

void writeInputPacket(unsigned long now) {
  if (transmitOffset >= transmitLength && now - lastPacketAt >= PACKET_INTERVAL_MS) {
    lastPacketAt = now;
    const int length = snprintf(transmitBuffer, sizeof(transmitBuffer),
      "{\"joystickX\":%d,\"joystickY\":%d,\"potentiometer\":%d,\"button\":%s}\n",
      int(filteredX / 8), int(filteredY / 8), int(filteredPot / 8), stableButton ? "true" : "false");
    transmitLength = length > 0 && length < int(sizeof(transmitBuffer)) ? uint8_t(length) : 0;
    transmitOffset = 0;
  }
  const int available = Serial.availableForWrite();
  if (available <= 0 || transmitOffset >= transmitLength) return;
  const uint8_t remaining = transmitLength - transmitOffset;
  const uint8_t count = available < remaining ? uint8_t(available) : remaining;
  Serial.write(reinterpret_cast<const uint8_t *>(transmitBuffer + transmitOffset), count);
  transmitOffset += count;
}

void setup() {
  pinMode(JOYSTICK_X, INPUT);
  pinMode(JOYSTICK_Y, INPUT);
  pinMode(POWER_KNOB, INPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(LINK_LED, LOW);
  pinMode(LINK_LED, OUTPUT);
  setupStorageBar();
  filteredX = int32_t(analogRead(JOYSTICK_X)) * 8;
  filteredY = int32_t(analogRead(JOYSTICK_Y)) * 8;
  filteredPot = int32_t(analogRead(POWER_KNOB)) * 8;
  Serial.begin(115200);
#if LASTLIGHT_LCD_ENABLED
  Wire.begin();
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(3000, true);
#endif
  lcdReady = lcd.begin(16, 2) == 0;
  if (lcdReady) { lcd.backlight(); lcdDirty = true; }
#endif
}

void loop() {
  const unsigned long now = millis();
  sampleControls(now);
  readHost(now);
  writeInputPacket(now);
  if (hostActive && now - lastHostAt > HOST_TIMEOUT_MS) {
    hostActive = false;
    storageValue = 0;
    writeStorageBar(0);
    digitalWrite(LINK_LED, LOW);
#if LASTLIGHT_LCD_ENABLED
    copyLcdRow(lcdRows[0], "HOST OFFLINE");
    copyLcdRow(lcdRows[1], "KEYBOARD READY");
    lcdDirty = true;
#endif
  }
#if LASTLIGHT_LCD_ENABLED
  refreshLcd(now);
#endif
}
