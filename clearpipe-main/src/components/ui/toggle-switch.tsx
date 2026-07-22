'use client';

import React from 'react';
import styled from 'styled-components';

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const ToggleSwitch = ({ id, checked, onChange, disabled = false }: ToggleSwitchProps) => {
  return (
    <StyledWrapper $disabled={disabled}>
      <div className="switch">
        <input 
          className="switch-check" 
          id={id} 
          type="checkbox" 
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <label className="switch-label" htmlFor={id}>
          Toggle
          <span />
        </label>
      </div>
    </StyledWrapper>
  );
};

const StyledWrapper = styled.div<{ $disabled?: boolean }>`
  /* Light theme styles */
  .switch {
    background-color: #e5e7eb;
    border-radius: 30px;
    border: 2px solid #d1d5db;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.1) inset;
    height: 19px;
    margin: 0;
    position: relative;
    width: 55px;
    display: inline-block;
    user-select: none;
    opacity: ${props => props.$disabled ? 0.5 : 1};
    pointer-events: ${props => props.$disabled ? 'none' : 'auto'};
    transition: background-color 0.2s, border-color 0.2s;
  }

  .switch-check {
    position: absolute;
    visibility: hidden;
    user-select: none;
  }

  .switch-label {
    cursor: ${props => props.$disabled ? 'not-allowed' : 'pointer'};
    display: block;
    height: 24px;
    text-indent: -9999px;
    width: 56px;
    user-select: none;
  }

  /* Left indicator (OFF - red) - Light theme */
  .switch-label:before {
    background: -webkit-radial-gradient(45%, circle, rgb(255, 58, 58) 0%, rgb(255, 113, 113) 100%);
    border-radius: 6px;
    border: 1px solid #b91c1c;
    box-shadow: 0 2px 5px rgba(239, 68, 68, 0.5), 0 0 5px rgba(248, 113, 113, 0.4) inset;
    content: "";
    display: block;
    height: 6px;
    left: -19%;
    position: absolute;
    top: 6px;
    transition: all 0.2s;
    width: 6px;
    z-index: 12;
    user-select: none;
  }

  /* Right indicator (inactive) - Light theme */
  .switch-label:after {
    background: transparent;
    border-radius: 6px;
    border: 1px solid #6b72806c;
    box-shadow: 0 1px 3px rgba(107, 114, 128, 0.01);
    content: "";
    display: block;
    height: 6px;
    left: -19%;
    position: absolute;
    top: 6px;
    transition: all 0.2s;
    width: 6px;
    z-index: 12;
    user-select: none;
  }

  /* Toggle knob - Light theme */
  .switch-label span {
    background: linear-gradient(to bottom, #ffffff, #f3f4f6);
    border-radius: 30px;
    border: 1px solid #d1d5db;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15), 
                0 1px 2px rgba(255, 255, 255, 0.8) inset;
    display: block;
    height: 12px;
    left: 2px;
    position: absolute;
    top: 2px;
    transition: all 0.2s linear;
    width: 24px;
    user-select: none;
  }

  /* Knob left gradient */
  .switch-label span:before {
    background: linear-gradient(to right, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.08));
    border-radius: 30px 6px 6px 30px;
    box-shadow: -1px 0 3px rgba(0, 0, 0, 0.08) inset;
    content: "";
    display: block;
    height: 10px;
    left: 2px;
    position: absolute;
    top: 1px;
    width: 10px;
    user-select: none;
  }

  /* Knob right gradient */
  .switch-label span:after {
    background: linear-gradient(to left, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.08));
    border-radius: 6px 30px 30px 6px;
    box-shadow: 1px 0 3px rgba(0, 0, 0, 0.08) inset;
    content: "";
    display: block;
    height: 10px;
    position: absolute;
    right: 2px;
    top: 1px;
    width: 10px;
    user-select: none;
  }

  /* Checked state - move knob */
  .switch-check:checked + .switch-label span {
    left: 28px;
  }

  /* Checked state - dim left indicator */
  .switch-check:checked + .switch-label:before {
    background: radial-gradient(circle at 45%, #9ca3af 0%, #6b7280 100%);
    border: 1px solid #6b7280;
    box-shadow: 0 1px 3px rgba(107, 114, 128, 0.3);
  }

  /* Checked state - light up right indicator (green) */
  .switch-check:checked + .switch-label:after {
    background: radial-gradient(circle at 45%, #22c55e 0%, #4ade80 100%);
    border: 1px solid #15803d;
    box-shadow: 0 1px 3px rgba(34, 197, 94, 0.5), 0 0 6px rgba(74, 222, 128, 0.4) inset;
  }

  /* ========== DARK THEME STYLES ========== */
  .dark &,
  :root.dark &,
  [data-theme="dark"] & {
    .switch {
      background-color: rgba(0, 0, 0, 0.2);
      border: 4px solid rgba(58, 58, 58, 0.1);
      box-shadow: 0 0 6px rgba(0, 0, 0, 0.5) inset;
      height: 23px;
      width: 62px;
    }

    .switch-label:before {
      background: -webkit-radial-gradient(45%, circle, rgb(255, 58, 58) 0%, rgb(255, 113, 113) 100%);
      border: 1px solid #742323;
      box-shadow: 0 2px 5px rgba(255, 67, 48, 0.6), 0 0 5px rgba(255, 159, 109, 0.5) inset;
    }

    .switch-label:after {
      background: -webkit-radial-gradient(45%, circle, rgba(60, 60, 60, 0.6) 0%, rgba(151, 151, 151, 0.6) 100%);
      border: 1px solid #111;
      box-shadow: 0 2px 5px rgba(20, 20, 20, 0.5);
    }

    .switch-label span {
      background: linear-gradient(#4f4f4f, #2b2b2b);
      border: 1px solid #1a1a1a;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5), 0 1px 1px rgba(255, 255, 255, 0.1) inset, 0 -2px 0 rgba(0, 0, 0, 0.2) inset;
    }

    .switch-label span:before {
      background: linear-gradient(to right, rgba(48, 48, 48, 0.4), rgba(34, 34, 34, 0.4));
      box-shadow: -2px 0 5px rgba(0, 0, 0, 0.2) inset;
    }

    .switch-label span:after {
      background: linear-gradient(to left, rgba(48, 48, 48, 0.4), rgba(34, 34, 34, 0.4));
      box-shadow: 2px 0 5px rgba(0, 0, 0, 0.2) inset;
    }
        /* Knob left gradient */
    .switch-label span:before {
        background: linear-gradient(to right, rgba(0, 0, 0, 0.03), rgba(0, 0, 0, 0.08));
        box-shadow: -1px 0 3px rgba(0, 0, 0, 0.08) inset;
    }

    /* Knob right gradient */
    .switch-label span:after {
        background: linear-gradient(to left, rgba(0, 0, 0, 0.03), rgba(0, 0, 0, 0.08));
        box-shadow: 1px 0 3px rgba(0, 0, 0, 0.08) inset;
    }

    .switch-check:checked + .switch-label:before {
      background: -webkit-radial-gradient(45%, circle, rgba(60, 60, 60, 0.6) 0%, rgba(151, 151, 151, 0.6) 100%);
      border: 1px solid #111;
      box-shadow: 0 2px 5px rgba(20, 20, 20, 0.5);
    }

    .switch-check:checked + .switch-label:after {
      background: -webkit-radial-gradient(45%, circle, lightgreen 0%, lightgreen 100%);
      border: 1px solid #004562;
      box-shadow: 0 2px 5px green, 0 0 5px green inset;
    }
  }
`;

export default ToggleSwitch;
