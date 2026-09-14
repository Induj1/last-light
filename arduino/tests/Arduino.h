#pragma once
// A host-side test double for the actual firmware's physical I/O boundary.
// Production compilation uses Arduino's own Arduino.h, never this file.
#include <cstdint>
#include <cstddef>
#include <deque>
#include <string>
#include <vector>
#define A0 14
#define A1 15
#define A2 16
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define HIGH 1
#define LOW 0
#define MSBFIRST 1
inline unsigned long fakeNow = 0;
inline int fakePins[32] = {};
inline int fakeModes[32] = {};
inline int fakeAdc[32] = {};
inline std::vector<uint8_t> shifted;
inline unsigned long millis() { return fakeNow; }
inline void pinMode(uint8_t pin, int mode) { fakeModes[pin] = mode; if (mode == INPUT_PULLUP) fakePins[pin] = HIGH; }
inline void digitalWrite(uint8_t pin, int value) { fakePins[pin] = value; }
inline int digitalRead(uint8_t pin) { return fakePins[pin]; }
inline int analogRead(uint8_t pin) { return fakeAdc[pin]; }
inline void shiftOut(uint8_t, uint8_t, uint8_t, uint8_t value) { shifted.push_back(value); }
class FakeSerial {
public:
  std::deque<char> receive;
  std::string transmitted;
  int writeSpace = 16;
  unsigned long baud = 0;
  void begin(unsigned long value) { baud = value; }
  int available() const { return int(receive.size()); }
  int read() { const auto value = receive.front(); receive.pop_front(); return value; }
  int availableForWrite() const { return writeSpace; }
  size_t write(const uint8_t *data, size_t count) {
    if (count > size_t(writeSpace)) throw "A transmit write would block";
    transmitted.append(reinterpret_cast<const char *>(data), count);
    return count;
  }
  void feed(const std::string &input) { for (char ch : input) receive.push_back(ch); }
};
inline FakeSerial Serial;
