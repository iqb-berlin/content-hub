<#-- Modified for IQB ContentPool / Content Hub: login labels, styling, form behavior,
     and accessibility. Adapted from Keycloak login templates (Apache-2.0).
     See ../LICENSE.txt and ../NOTICE.md for license and provenance information. -->
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    <#if section = "header">
        Anmelden
    <#elseif section = "form">
        <div id="kc-form">
            <div id="kc-form-wrapper">
                <#if realm.password>
                    <form id="kc-form-login" class="iqb-form" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
                        <#if !usernameHidden??>
                            <div class="form-group">
                                <label for="username" class="pf-c-form__label pf-c-form__label-text">
                                    <#if !realm.loginWithEmailAllowed>${msg("username")}
                                    <#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}
                                    <#else>${msg("email")}
                                    </#if>
                                </label>
                                <input tabindex="2" id="username" class="pf-c-form-control" name="username"
                                       value="${(login.username!'')}" type="text"
                                       autofocus autocomplete="off"
                                       aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                />
                                <#if messagesPerField.existsError('username','password')>
                                    <span id="input-error" class="pf-c-form__helper-text pf-m-error required" aria-live="polite">
                                        ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                                    </span>
                                </#if>
                            </div>
                        </#if>

                        <div class="form-group">
                            <label for="password" class="pf-c-form__label pf-c-form__label-text">${msg("password")}</label>
                            <div class="pf-c-input-group">
                                <input tabindex="3" id="password" class="pf-c-form-control" name="password"
                                       type="password" autocomplete="off"
                                       aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                />
                                <button class="pf-c-button pf-m-control" type="button" aria-label="${msg("showPassword")}"
                                        aria-controls="password" data-password-toggle tabindex="4"
                                        data-icon-show="fa fa-eye" data-icon-hide="fa fa-eye-slash"
                                        data-label-show="${msg("showPassword")}" data-label-hide="${msg("hidePassword")}">
                                    <i class="fa fa-eye" aria-hidden="true"></i>
                                </button>
                            </div>
                        </div>

                        <div class="form-group login-pf-settings">
                            <div id="kc-form-options">
                                <#if realm.rememberMe??>
                                    <div class="checkbox">
                                        <label>
                                            <input tabindex="5" id="rememberMe" name="rememberMe" type="checkbox"
                                                   value="on" ${(login.rememberMe?? && login.rememberMe == 'on')?then('checked', '')}>
                                            ${msg("rememberMe")}
                                        </label>
                                    </div>
                                </#if>
                            </div>
                            <div class="">
                                <#if realm.resetPasswordAllowed>
                                    <span><a tabindex="6" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a></span>
                                </#if>
                            </div>
                        </div>

                        <div id="kc-form-buttons" class="form-group">
                            <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                            <input tabindex="7" class="pf-c-button pf-m-primary pf-m-block btn-lg" name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
                        </div>
                    </form>
                </#if>
            </div>
        </div>
        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    <#elseif section = "info">
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("noAccount")} <a tabindex="8" href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>
        </#if>
    <#elseif section = "socialProviders">
        <#if realm.password && social.providers??>
            <div id="kc-social-providers" class="${properties.kcFormSocialAccountSectionClass!}">
                <hr/>
                <h2>${msg("identity-provider-login-label")}</h2>
                <ul class="${properties.kcFormSocialAccountListClass!} <#if social.providers?size gt 3>${properties.kcFormSocialAccountListGridClass!}</#if>">
                    <#list social.providers as p>
                        <a id="social-${p.alias}" class="${properties.kcFormSocialAccountListButtonClass!} <#if social.providers?size gt 3>${properties.kcFormSocialAccountGridItem!}</#if>"
                                type="button" href="${p.loginUrl}">
                            <#if p.iconClasses?has_content>
                                <i class="${p.iconClasses}" aria-hidden="true"></i>
                                <span class="${properties.kcFormSocialAccountNameClass!} kc-social-icon-text">${p.displayName!}</span>
                            <#else>
                                <span class="${properties.kcFormSocialAccountNameClass!}">${p.displayName!}</span>
                            </#if>
                        </a>
                    </#list>
                </ul>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
