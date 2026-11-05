from celery import shared_task
from django.core.mail import send_mail


@shared_task
def send_email(subject: str, body: str, to: list[str]) -> int:
    """メールを非同期で送信する。開発では Mailpit が受ける。"""
    return send_mail(subject, body, None, to)
