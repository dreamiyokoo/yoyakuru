"""
public スキーマ専用の Django Admin サイト（admin.dreami.blog/admin/）。
Tenant / Domain / User / Group を管理する。
"""

from django.contrib.auth.admin import GroupAdmin, UserAdmin
from django.contrib.auth.models import Group, User
from unfold.sites import UnfoldAdminSite


class PublicAdminSite(UnfoldAdminSite):
    site_header = "ヨヤクル Platform"
    site_title = "ヨヤクル Platform Admin"
    index_title = "テナント管理"


public_admin_site = PublicAdminSite(name="public_admin")

public_admin_site.register(User, UserAdmin)
public_admin_site.register(Group, GroupAdmin)
