from unfold.admin import ModelAdmin as UnfoldModelAdmin

from .admin_site import public_admin_site
from .models import Domain, Tenant


class TenantAdmin(UnfoldModelAdmin):
    list_display = ("name", "subdomain", "schema_name", "is_active", "created_at")
    list_filter = ("is_active",)
    search_fields = ("name", "subdomain", "admin_email")
    readonly_fields = ("schema_name", "created_at")


class DomainAdmin(UnfoldModelAdmin):
    list_display = ("domain", "tenant", "is_primary")
    list_filter = ("is_primary",)
    search_fields = ("domain",)


public_admin_site.register(Tenant, TenantAdmin)
public_admin_site.register(Domain, DomainAdmin)
