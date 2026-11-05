from django.core.management.base import BaseCommand

from apps.bookings.services import expire_holds


class Command(BaseCommand):
    help = "期限を過ぎた仮押さえを期限切れにする"

    def handle(self, *args, **options):
        count = expire_holds()
        self.stdout.write(f"expired={count}")
