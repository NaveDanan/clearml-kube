import smtplib
import ssl
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from email.utils import formataddr
from typing import Optional, Sequence

from apiserver.config_repo import config

log = config.logger(__file__)


class EmailSettings:
    """Thin typed accessors over the apiserver.email.* configuration block."""

    @staticmethod
    def enabled() -> bool:
        return bool(config.get("apiserver.email.enabled", False))

    @staticmethod
    def smtp_server() -> str:
        return config.get("apiserver.email.smtp_server", "")

    @staticmethod
    def smtp_port() -> int:
        return int(config.get("apiserver.email.smtp_port", 587))

    @staticmethod
    def use_tls() -> bool:
        return bool(config.get("apiserver.email.use_tls", True))

    @staticmethod
    def use_ssl() -> bool:
        return bool(config.get("apiserver.email.use_ssl", False))

    @staticmethod
    def username() -> str:
        return config.get("apiserver.email.username", "")

    @staticmethod
    def password() -> str:
        return config.get("apiserver.email.password", "")

    @staticmethod
    def sender() -> str:
        return config.get("apiserver.email.sender", "clearml@localhost")

    @staticmethod
    def sender_name() -> str:
        return config.get("apiserver.email.sender_name", "ClearML")

    @staticmethod
    def timeout_sec() -> int:
        return int(config.get("apiserver.email.timeout_sec", 10))

    @staticmethod
    def max_workers() -> int:
        return int(config.get("apiserver.email.max_workers", 4))


class EmailSender:
    """
    Sends email through the configured SMTP relay. Sending happens on a small
    background thread pool so it never blocks the API request path. All failures
    are logged and swallowed -- email delivery must never break an API call.
    """

    _executor: Optional[ThreadPoolExecutor] = None

    @classmethod
    def _get_executor(cls) -> ThreadPoolExecutor:
        if cls._executor is None:
            cls._executor = ThreadPoolExecutor(
                max_workers=EmailSettings.max_workers(),
                thread_name_prefix="email-sender",
            )
        return cls._executor

    @classmethod
    def enabled(cls) -> bool:
        return EmailSettings.enabled() and bool(EmailSettings.smtp_server())

    @classmethod
    def send_async(
        cls,
        recipients: Sequence[str],
        subject: str,
        body_text: str,
        body_html: str = None,
    ) -> None:
        """Queue an email for delivery. No-op when email is disabled."""
        recipients = [r for r in (recipients or []) if r]
        if not cls.enabled() or not recipients:
            return
        cls._get_executor().submit(
            cls._send, list(recipients), subject, body_text, body_html
        )

    @classmethod
    def _send(
        cls,
        recipients: Sequence[str],
        subject: str,
        body_text: str,
        body_html: str = None,
    ) -> None:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = formataddr(
                (EmailSettings.sender_name(), EmailSettings.sender())
            )
            msg["To"] = ", ".join(recipients)
            msg.set_content(body_text)
            if body_html:
                msg.add_alternative(body_html, subtype="html")

            host = EmailSettings.smtp_server()
            port = EmailSettings.smtp_port()
            timeout = EmailSettings.timeout_sec()

            if EmailSettings.use_ssl():
                context = ssl.create_default_context()
                smtp = smtplib.SMTP_SSL(host, port, timeout=timeout, context=context)
            else:
                smtp = smtplib.SMTP(host, port, timeout=timeout)

            with smtp:
                if EmailSettings.use_tls() and not EmailSettings.use_ssl():
                    smtp.starttls(context=ssl.create_default_context())
                username = EmailSettings.username()
                if username:
                    smtp.login(username, EmailSettings.password())
                smtp.send_message(msg)

            log.info(f"Sent notification email to {len(recipients)} recipient(s)")
        except Exception as ex:
            log.error(f"Failed sending notification email: {ex}")
