from django.urls import path

from . import views

# /api/v1/public/ 配下。お客様向けでログイン不要。店舗はURLの店舗名で決める
urlpatterns = [
    path("tenants/<slug:subdomain>/", views.StoreView.as_view()),
    path("tenants/<slug:subdomain>/availability", views.AvailabilityView.as_view()),
    path("tenants/<slug:subdomain>/bookings", views.HoldView.as_view()),
    path("tenants/<slug:subdomain>/chat", views.ChatView.as_view()),
    path("bookings/confirm", views.ConfirmView.as_view()),
    path("bookings/<str:token>", views.BookingByTokenView.as_view()),
    path("bookings/<str:token>/cancel", views.CancelView.as_view()),
    path("bookings/<str:token>/ics", views.IcsView.as_view()),
]
