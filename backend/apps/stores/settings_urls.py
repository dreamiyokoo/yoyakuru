from django.urls import path

from . import settings_api as v

# /api/v1/admin/tenants/<店舗名>/settings/ 配下。オーナーのみ
urlpatterns = [
    path("store", v.StoreSettingsView.as_view()),
    path("warnings", v.SettingWarningsView.as_view()),
    path("assistant", v.SetupAssistantView.as_view()),
    path("history", v.HistoryView.as_view()),
    path("members", v.MemberListView.as_view()),
    path("members/<int:pk>", v.MemberDetailView.as_view()),
    path("members/<int:pk>/reset-2fa", v.MemberTwoFactorResetView.as_view()),
    path("invitations", v.InvitationListView.as_view()),
    path("invitations/<int:pk>", v.InvitationDetailView.as_view()),
    path("history/undo", v.UndoView.as_view()),
    path("templates", v.SetupTemplateView.as_view()),
    path("templates/<slug:key>", v.SetupTemplateView.as_view()),
    path("hours", v.BusinessHoursView.as_view()),
    path("breaks", v.BreakListView.as_view()),
    path("breaks/<int:pk>", v.BreakDetailView.as_view()),
    path("date-overrides", v.DateOverrideListView.as_view()),
    path("date-overrides/<int:pk>", v.DateOverrideDetailView.as_view()),
    path("resources", v.ResourceListView.as_view()),
    path("resources/<int:pk>", v.ResourceDetailView.as_view()),
    path("services", v.ServiceListView.as_view()),
    path("services/<int:pk>", v.ServiceDetailView.as_view()),
    path("staff", v.StaffListView.as_view()),
    path("staff/order", v.StaffOrderView.as_view()),
    path("staff/<int:pk>", v.StaffDetailView.as_view()),
    path("staff/<int:pk>/shifts", v.StaffShiftView.as_view()),
    path("staff/<int:pk>/exceptions", v.StaffExceptionListView.as_view()),
    path("staff/<int:pk>/exceptions/<int:eid>", v.StaffExceptionDetailView.as_view()),
]
