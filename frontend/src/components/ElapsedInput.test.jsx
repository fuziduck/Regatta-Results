// Elapsed time entry (hh:mm:ss). The value must commit ONCE, when the officer
// has finished the whole duration — moving between the three fields is not a
// finished time, and committing there would score 1h, then 1h30m, then
// 1h30m00s as three separate results while the fleet re-sequences.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ElapsedInput } from "./ElapsedInput";

const RACE = { date: "2026-05-02", start_time: "13:00" };

let container;
let root;
const onCommit = jest.fn();

const render = (props = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ElapsedInput finishTime={null} race={RACE} onCommit={onCommit} {...props} />);
  });
  return [...container.querySelectorAll("input")];
};

const rerender = (props) =>
  act(() => root.render(<ElapsedInput finishTime={null} race={RACE} onCommit={onCommit} {...props} />));

const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const leave = (input, to) =>
  act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: to })));

const pressEnter = (input) =>
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));

beforeEach(() => jest.clearAllMocks());

afterEach(() => {
  act(() => root.unmount());
  root = null;
  container.remove();
  container = null;
});

test("commits the completed duration once, when focus leaves the group", () => {
  const [h, m, s] = render();
  type(h, "1");
  type(m, "30");
  type(s, "0");
  expect(onCommit).not.toHaveBeenCalled();
  leave(s, document.body);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(5400);
});

test("moving between the hours, minutes and seconds fields commits nothing", () => {
  const [h, m, s] = render();
  type(h, "1");
  leave(h, m);
  type(m, "30");
  leave(m, s);
  expect(onCommit).not.toHaveBeenCalled();
  leave(s, document.body);
  expect(onCommit).toHaveBeenCalledWith(5400);
});

test("Enter commits without leaving the field", () => {
  const [h] = render();
  type(h, "2");
  pressEnter(h);
  expect(onCommit).toHaveBeenCalledWith(7200);
});

test("an untouched or all-zero group records nothing", () => {
  const [h, m, s] = render();
  leave(h, document.body);
  type(h, "0");
  type(m, "0");
  type(s, "0");
  leave(s, document.body);
  expect(onCommit).not.toHaveBeenCalled();
});

// The officer correcting the race start re-times every finish on screen; the
// field must follow, or a correction gets measured from the start that was
// wrong in the first place.
test("follows the race start when it is corrected", () => {
  const fixed = { date: "2026-05-02", start_time: "13:00", start_tz_offset_minutes: 0 };
  const finishTime = "2026-05-02T14:30:00Z";
  render({ finishTime, race: fixed });
  expect([...container.querySelectorAll("input")].map((i) => i.value)).toEqual(["1", "30", "0"]);

  rerender({ finishTime, race: { ...fixed, start_time: "13:20" } });
  expect([...container.querySelectorAll("input")].map((i) => i.value)).toEqual(["1", "10", "0"]);
});
