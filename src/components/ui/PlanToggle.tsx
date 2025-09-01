import React from "react";
import "./PlanToggle.css";

interface PlanToggleProps {
  value: string;
  onChange: (value: string) => void;
}

const options = [
  { label: "Weekly", value: "weekly", id: "economical" },
  { label: "Monthly", value: "monthly", id: "balanced" },
  { label: "Annual", value: "annual", id: "performance" },
];

export const PlanToggle: React.FC<PlanToggleProps> = ({ value, onChange }) => (
  <div className="toggle-group" style={{ margin: '0 auto 24px auto' }}>
    {options.map(opt => (
      <React.Fragment key={opt.value}>
        <input
          type="radio"
          id={opt.id}
          name="plan-toggle"
          value={opt.value}
          checked={value === opt.value}
          onChange={() => onChange(opt.value)}
        />
        <label htmlFor={opt.id}>{opt.label}</label>
      </React.Fragment>
    ))}
  </div>
);
