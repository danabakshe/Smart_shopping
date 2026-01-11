from __future__ import annotations
import os
import smtplib
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional


def is_valid_email(email: str) -> bool:
    """Validate email format."""
    if not isinstance(email, str):
        return False
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email.strip()))


def send_password_reset_email(email: str, code: str) -> bool:
    """
    Send password reset code via email.
    Returns True if sent successfully, False otherwise.
    """
    if not is_valid_email(email):
        return False

    # For development: if SMTP not configured, print to console
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM", smtp_user)

    # If SMTP not configured, print to console (for development)
    if not smtp_host or not smtp_user or not smtp_password:
        print(f"\n{'='*60}")
        print(f"PASSWORD RESET CODE (SMTP not configured)")
        print(f"{'='*60}")
        print(f"To: {email}")
        print(f"Code: {code}")
        print(f"{'='*60}\n")
        return True

    try:
        # Create message
        msg = MIMEMultipart()
        msg["From"] = smtp_from
        msg["To"] = email
        msg["Subject"] = "Password Reset Code - Smart Shopping"

        body = f"""
Your password reset code is: {code}

This code will expire in 10 minutes.

If you did not request this code, please ignore this email.
"""
        msg.attach(MIMEText(body, "plain"))

        # Send email
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            if smtp_port == 587:
                server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)

        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        # In development, still print to console as fallback
        print(f"\n{'='*60}")
        print(f"PASSWORD RESET CODE (Email failed, showing here)")
        print(f"{'='*60}")
        print(f"To: {email}")
        print(f"Code: {code}")
        print(f"{'='*60}\n")
        return False

