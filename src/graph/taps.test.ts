import { DOUBLE_TAP_MS, createTapClassifier } from './taps';

function setup(hasDouble = true) {
  const single = jest.fn();
  const double = jest.fn();
  const classifier = createTapClassifier<string>(
    { single, double, hasDouble: () => hasDouble },
    { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
  );
  return { single, double, classifier };
}

describe('createTapClassifier', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('un clic espera y despues es simple', () => {
    const { single, double, classifier } = setup();
    classifier.tap('a', 'A');
    expect(single).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(single).toHaveBeenCalledWith('A');
    expect(double).not.toHaveBeenCalled();
  });

  it('dos clics a tiempo sobre el mismo nodo son un doble clic, sin el simple', () => {
    const { single, double, classifier } = setup();
    classifier.tap('a', 'A');
    jest.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    classifier.tap('a', 'A');
    expect(double).toHaveBeenCalledWith('A');
    jest.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(single).not.toHaveBeenCalled();
  });

  it('dos clics separados son dos simples', () => {
    const { single, double, classifier } = setup();
    classifier.tap('a', 'A');
    jest.advanceTimersByTime(DOUBLE_TAP_MS + 10);
    classifier.tap('a', 'A');
    jest.advanceTimersByTime(DOUBLE_TAP_MS + 10);
    expect(single).toHaveBeenCalledTimes(2);
    expect(double).not.toHaveBeenCalled();
  });

  it('un clic rapido en otro nodo descarta el primero y no es doble', () => {
    const { single, double, classifier } = setup();
    classifier.tap('a', 'A');
    classifier.tap('b', 'B');
    jest.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(single).toHaveBeenCalledTimes(1);
    expect(single).toHaveBeenCalledWith('B');
    expect(double).not.toHaveBeenCalled();
  });

  it('sin doble clic posible, el clic no espera', () => {
    const { single, double, classifier } = setup(false);
    classifier.tap('a', 'A');
    expect(single).toHaveBeenCalledWith('A');
    classifier.tap('a', 'A');
    expect(single).toHaveBeenCalledTimes(2);
    expect(double).not.toHaveBeenCalled();
  });

  it('cancel descarta el clic pendiente', () => {
    const { single, classifier } = setup();
    classifier.tap('a', 'A');
    classifier.cancel();
    jest.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(single).not.toHaveBeenCalled();
  });
});
