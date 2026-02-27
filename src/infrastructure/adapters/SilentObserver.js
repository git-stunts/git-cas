/**
 * No-op observability adapter. All methods are empty.
 * Used as the default when no observability is configured.
 */
export default class SilentObserver {
  metric(_channel, _data) {}
  log(_level, _msg, _meta) {}
  span(_name) {
    return { end() {} };
  }
}
