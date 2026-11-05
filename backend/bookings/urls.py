from django.urls import path

from . import views

urlpatterns = [
    path("stores/<slug:slug>/", views.StoreView.as_view()),
    path("stores/<slug:slug>/availability", views.AvailabilityView.as_view()),
    path("stores/<slug:slug>/bookings", views.HoldView.as_view()),
    path("bookings/confirm", views.ConfirmView.as_view()),
    path("bookings/<str:token>", views.BookingByTokenView.as_view()),
    path("bookings/<str:token>/cancel", views.CancelView.as_view()),
]
