"use client";

import React, { useState, useRef, useEffect } from "react";
import styles from "./PhoneInput.module.css";

interface PhoneInputProps {
  value: unknown;
  onChange: (value: string) => void;
  onClose: () => void;
}

const countryCodes = [
  { code: "+51", country: "Perú", flag: "🇵🇪", lengths: [9], groups: [3, 3, 3], example: "987 654 321" },
  { code: "+1", country: "USA/Canadá", flag: "🇺🇸", lengths: [10], groups: [3, 3, 4], example: "555 123 4567" },
  { code: "+52", country: "México", flag: "🇲🇽", lengths: [10], groups: [2, 4, 4], example: "55 1234 5678" },
  { code: "+34", country: "España", flag: "🇪🇸", lengths: [9], groups: [3, 3, 3], example: "612 345 678" },
  { code: "+54", country: "Argentina", flag: "🇦🇷", lengths: [10], groups: [2, 4, 4], example: "11 2345 6789" },
  { code: "+56", country: "Chile", flag: "🇨🇱", lengths: [9], groups: [1, 4, 4], example: "9 1234 5678" },
  { code: "+57", country: "Colombia", flag: "🇨🇴", lengths: [10], groups: [3, 3, 4], example: "300 123 4567" },
  { code: "+58", country: "Venezuela", flag: "🇻🇪", lengths: [10], groups: [3, 3, 4], example: "412 123 4567" },
  { code: "+593", country: "Ecuador", flag: "🇪🇨", lengths: [9], groups: [2, 3, 4], example: "99 123 4567" },
  { code: "+55", country: "Brasil", flag: "🇧🇷", lengths: [10, 11], groups: [2, 5, 4], example: "11 91234 5678" },
];

const digitsOnly = (value: string) => value.replace(/\D/g, "");

const formatByGroups = (digits: string, groups: number[]) => {
  const parts: string[] = [];
  let cursor = 0;
  for (const group of groups) {
    const part = digits.slice(cursor, cursor + group);
    if (part) parts.push(part);
    cursor += group;
  }
  const rest = digits.slice(cursor);
  if (rest) parts.push(rest);
  return parts.join(" ");
};

export const PhoneInput: React.FC<PhoneInputProps> = ({ value, onChange, onClose }) => {
  const stringValue = typeof value === "string" ? value : "";
  
  // Parse existing value
  const parsePhone = (val: string) => {
    const match = countryCodes.find((country) => val.trim().startsWith(country.code));
    if (match) return { code: match.code, number: formatByGroups(digitsOnly(val.slice(match.code.length)), match.groups) };
    return { code: "+51", number: val };
  };

  const parsed = parsePhone(stringValue);
  const [countryCode, setCountryCode] = useState(parsed.code);
  const [phoneNumber, setPhoneNumber] = useState(parsed.number);
  const [showCodeDropdown, setShowCodeDropdown] = useState(false);
  const selectedCountry = countryCodes.find((country) => country.code === countryCode) || countryCodes[0];
  const currentDigits = digitsOnly(phoneNumber);
  const isValidLength = selectedCountry.lengths.includes(currentDigits.length);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  const handlePhoneChange = (newNumber: string) => {
    const formatted = formatByGroups(digitsOnly(newNumber).slice(0, Math.max(...selectedCountry.lengths)), selectedCountry.groups);
    setPhoneNumber(formatted);
    onChange(`${countryCode} ${formatted}`);
  };

  const handleCodeChange = (newCode: string) => {
    const country = countryCodes.find((item) => item.code === newCode) || countryCodes[0];
    const formatted = formatByGroups(currentDigits.slice(0, Math.max(...country.lengths)), country.groups);
    setCountryCode(newCode);
    setPhoneNumber(formatted);
    onChange(`${newCode} ${formatted}`);
    setShowCodeDropdown(false);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.phoneInputWrapper}>
        <button
          type="button"
          className={styles.codeButton}
          onClick={() => setShowCodeDropdown(!showCodeDropdown)}
        >
          {selectedCountry.flag} {countryCode}
        </button>
        <input
          type="tel"
          className={styles.phoneInput}
          value={phoneNumber}
          onChange={(e) => handlePhoneChange(e.target.value)}
          placeholder={selectedCountry.example}
          autoFocus
        />
      </div>
      <div className={isValidLength || !currentDigits ? styles.phoneHint : styles.phoneHintError}>
        {currentDigits ? `${currentDigits.length}/${selectedCountry.lengths.join(" o ")} dígitos` : `Formato: ${selectedCountry.example}`}
      </div>
      
      {showCodeDropdown && (
        <div className={styles.codeDropdown} ref={dropdownRef}>
          {countryCodes.map((country) => (
            <button
              key={country.code}
              type="button"
              className={styles.codeOption}
              onClick={() => handleCodeChange(country.code)}
            >
              <span className={styles.flag}>{country.flag}</span>
              <span className={styles.countryName}>{country.country}</span>
              <span className={styles.code}>{country.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
