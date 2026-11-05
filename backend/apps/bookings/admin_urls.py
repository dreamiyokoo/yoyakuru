from django.urls import path

from . import admin_api as v

# /api/v1/admin/tenants/<店舗名>/ 配下。店舗利用者のログインと所属が必要
urlpatterns = [
    path("options", v.OptionsView.as_view()),
    path("bookings", v.BookingListView.as_view()),
    path("bookings/<int:pk>", v.BookingDetailView.as_view()),
    path("bookings/<int:pk>/cancel", v.BookingCancelView.as_view()),
    path("bookings/<int:pk>/reschedule", v.BookingRescheduleView.as_view()),
    path("availability", v.AdminAvailabilityView.as_view()),
    path("calendar", v.CalendarView.as_view()),
    path("time-offs", v.TimeOffListView.as_view()),
    path("time-offs/<int:pk>", v.TimeOffDetailView.as_view()),
]
