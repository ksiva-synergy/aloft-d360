/**
 * Helpers for the themed Select combobox (@/components/form/Select) in jsdom tests.
 * Native `<select>` APIs (options, fireEvent.change on value) do not apply to the trigger button.
 */
import { fireEvent, screen, within } from '@testing-library/react';

export function selectTrigger(label: string | RegExp): HTMLElement {
  return screen.getByLabelText(label);
}

export function selectValue(label: string | RegExp): string {
  return selectTrigger(label).getAttribute('data-value') ?? '';
}

export function openSelect(label: string | RegExp): HTMLElement {
  const trigger = selectTrigger(label);
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return trigger;
}

export function closeSelect(label: string | RegExp): void {
  const trigger = selectTrigger(label);
  if (trigger.getAttribute('aria-expanded') === 'true') {
    fireEvent.keyDown(trigger, { key: 'Escape' });
  }
}

export function selectListbox(): HTMLElement {
  return screen.getByRole('listbox');
}

/** Choose an option by its `value` attribute (matches native select change events). */
export function chooseSelectValue(label: string | RegExp, value: string): void {
  openSelect(label);
  const listbox = selectListbox();
  const option =
    listbox.querySelector(`[role="option"][data-value="${CSS.escape(value)}"]`) ??
    within(listbox).getByRole('option', { name: value });
  fireEvent.click(option as HTMLElement);
}

/** Option values in menu order (includes empty placeholder). */
export function selectOptionValues(label: string | RegExp): string[] {
  openSelect(label);
  const values = within(selectListbox())
    .getAllByRole('option')
    .map((el) => el.getAttribute('data-value') ?? '');
  closeSelect(label);
  return values;
}
