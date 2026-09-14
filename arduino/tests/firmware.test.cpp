#include <cassert>
#include <iostream>
#include "../LastLight/LastLight.ino"

void feed(const std::string &input) {
  Serial.feed(input);
  while (Serial.available()) loop();
}

void assertDisplay(unsigned int count) {
#if LASTLIGHT_LED_MODE == 1
  for (unsigned int i = 0; i < LASTLIGHT_LED_SEGMENTS; i++) {
    const bool expected = (i < count) != bool(LASTLIGHT_LED_ACTIVE_LOW);
    assert(fakePins[LED_PINS[i]] == expected);
  }
#elif LASTLIGHT_LED_MODE == 2
  assert(shifted.size() >= 2);
  uint16_t actual = uint16_t(shifted[shifted.size() - 2]) << 8 | shifted.back();
  uint16_t expected = count == 16 ? 0xFFFF : (uint32_t(1) << count) - 1;
  if (LASTLIGHT_LED_ACTIVE_LOW) expected = ~expected;
  assert(actual == expected);
#else
  (void)count;
  for (unsigned int pin = 3; pin <= 12; pin++) assert(fakeModes[pin] == INPUT);
#endif
}

int main() {
  fakeAdc[A0] = 512; fakeAdc[A1] = 508; fakeAdc[A2] = 734;
  setup();
  assert(Serial.baud == 115200);
  assert(fakeModes[BUTTON_PIN] == INPUT_PULLUP);
  assertDisplay(0);

  feed("STORAGE:100\n");
  assert(hostActive && storageValue == 100);
  assertDisplay(LASTLIGHT_LED_SEGMENTS);
  feed("STORAGE:50\r\n");
  assert(storageValue == 50);
  assertDisplay((LASTLIGHT_LED_SEGMENTS + 1) / 2);
  feed("TEST:1\n");
  assertDisplay(1);
  feed("TEST:0\n");
  assertDisplay(0);

  for (const std::string bad : { "101", "-1", "+5", "50x", "1.2", "", "999999", " 50", "50 " }) {
    feed("STORAGE:" + bad + "\n");
    assert(storageValue == 0);
  }
  Serial.feed(std::string(200, 'X') + "\nSTORAGE:75\n");
  loop();
  assert(Serial.available() == 200 + 1 + 11 - 32); // A single loop consumes at most 32 bytes.
  while (Serial.available()) loop();
  assert(storageValue == 75); // Overlong lines recover at newline.
  feed(std::string("STORAGE:10\0junk\n", 16) + "STORAGE:25\n");
  assert(storageValue == 25); // Embedded NUL cannot hide trailing data.

  // Backpressure never blocks or replaces a partially transmitted JSON frame.
  fakeNow = 40;
  Serial.writeSpace = 0;
  loop();
  assert(Serial.transmitted.empty());
  Serial.writeSpace = 16;
  for (int i = 0; i < 10; i++) loop();
  assert(Serial.transmitted == "{\"joystickX\":512,\"joystickY\":508,\"potentiometer\":734,\"button\":false}\n");

  fakePins[BUTTON_PIN] = LOW;
  fakeNow = 50; loop();
  fakeNow = 74; loop();
  assert(!stableButton);
  fakeNow = 75; loop();
  assert(stableButton);
  fakePins[BUTTON_PIN] = HIGH;
  fakeNow = 76; loop();
  fakePins[BUTTON_PIN] = LOW;
  fakeNow = 80; loop();
  assert(stableButton); // A short release bounce does not create a new press.

  fakeNow = 6000; loop();
  assert(!hostActive && storageValue == 0 && fakePins[LINK_LED] == LOW);
  assertDisplay(0);
  feed("STORAGE:100\n");
  assert(hostActive);
  assertDisplay(LASTLIGHT_LED_SEGMENTS);
  std::cout << "PASS: mode " << LASTLIGHT_LED_MODE << ", segments " << LASTLIGHT_LED_SEGMENTS
            << ", active-low " << LASTLIGHT_LED_ACTIVE_LOW << " — parser, buffer bounds, LED mapping, timeout, debounce, UART backpressure\n";
}
