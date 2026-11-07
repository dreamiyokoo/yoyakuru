from django.urls import include, path

from . import admin_api as v

# /api/v1/admin/tenants/<店舗名>/ 配下。店舗利用者のログインと所属が必要
urlpatterns = [
    path("options", v.OptionsView.as_view()),
    path("bookings", v.BookingListView.as_view()),
    path("bookings/<int:pk>", v.BookingDetailView.as_view()),
    path("bookings/<int:pk>/cancel", v.BookingCancelView.as_view()),
    path("bookings/<int:pk>/reschedule", v.BookingRescheduleView.as_view()),
    path("availability", v.AdminAvailabilityView.as_view()),
    path("settings/", include("apps.stores.settings_urls")),
]
