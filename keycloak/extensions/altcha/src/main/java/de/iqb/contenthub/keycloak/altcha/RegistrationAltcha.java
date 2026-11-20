package de.iqb.contenthub.keycloak.altcha;

import org.altcha.altcha.v2.Altcha;
import org.jboss.logging.Logger;
import org.keycloak.Config;
import org.keycloak.authentication.FormAction;
import org.keycloak.authentication.FormActionFactory;
import org.keycloak.authentication.FormContext;
import org.keycloak.authentication.ValidationContext;
import org.keycloak.events.Details;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;
import org.keycloak.provider.ConfiguredProvider;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.validation.Validation;

import jakarta.ws.rs.core.MultivaluedMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class RegistrationAltcha implements FormAction, FormActionFactory, ConfiguredProvider {
    public static final String PROVIDER_ID = "registration-altcha-action";
    public static final String ALTCHA_FIELD = "altcha";
    public static final String HMAC_SECRET = "hmac.secret";
    public static final String ALGORITHM = "algorithm";
    public static final String COST = "cost";
    public static final String EXPIRES_SECONDS = "expires.seconds";
    public static final String KEY_PREFIX = "key.prefix";
    public static final String ENV_HMAC_SECRET = "ALTCHA_HMAC_SECRET";

    private static final Logger logger = Logger.getLogger(RegistrationAltcha.class);
    private static final String DEFAULT_ALGORITHM = "PBKDF2/SHA-256";
    private static final int DEFAULT_COST = 5000;
    private static final long DEFAULT_EXPIRES_SECONDS = 300L;
    private static final String DEFAULT_KEY_PREFIX = "00";
    private static final ConcurrentHashMap<String, Long> USED_NONCES = new ConcurrentHashMap<>();

    private static final AuthenticationExecutionModel.Requirement[] REQUIREMENT_CHOICES = {
            AuthenticationExecutionModel.Requirement.REQUIRED,
            AuthenticationExecutionModel.Requirement.DISABLED
    };

    private static final List<ProviderConfigProperty> CONFIG_PROPERTIES = new ArrayList<>();

    static {
        ProviderConfigProperty property;

        property = new ProviderConfigProperty();
        property.setName(HMAC_SECRET);
        property.setLabel("ALTCHA HMAC Secret");
        property.setType(ProviderConfigProperty.PASSWORD);
        property.setSecret(true);
        property.setHelpText("Secret used to sign and verify ALTCHA challenges. If empty, the provider reads ALTCHA_HMAC_SECRET from the Keycloak environment.");
        CONFIG_PROPERTIES.add(property);

        property = new ProviderConfigProperty();
        property.setName(ALGORITHM);
        property.setLabel("Algorithm");
        property.setType(ProviderConfigProperty.LIST_TYPE);
        property.setOptions(List.of("PBKDF2/SHA-256", "PBKDF2/SHA-384", "PBKDF2/SHA-512", "SHA-256", "SHA-384", "SHA-512"));
        property.setDefaultValue(DEFAULT_ALGORITHM);
        property.setHelpText("ALTCHA proof-of-work algorithm. PBKDF2/SHA-256 is the recommended default for browser compatibility.");
        CONFIG_PROPERTIES.add(property);

        property = new ProviderConfigProperty();
        property.setName(COST);
        property.setLabel("Cost");
        property.setType(ProviderConfigProperty.STRING_TYPE);
        property.setDefaultValue(Integer.toString(DEFAULT_COST));
        property.setHelpText("Proof-of-work cost. Higher values slow bots more but also increase browser work for real users.");
        CONFIG_PROPERTIES.add(property);

        property = new ProviderConfigProperty();
        property.setName(EXPIRES_SECONDS);
        property.setLabel("Expires in seconds");
        property.setType(ProviderConfigProperty.STRING_TYPE);
        property.setDefaultValue(Long.toString(DEFAULT_EXPIRES_SECONDS));
        property.setHelpText("Challenge lifetime in seconds.");
        CONFIG_PROPERTIES.add(property);

        property = new ProviderConfigProperty();
        property.setName(KEY_PREFIX);
        property.setLabel("Key prefix");
        property.setType(ProviderConfigProperty.STRING_TYPE);
        property.setDefaultValue(DEFAULT_KEY_PREFIX);
        property.setHelpText("Required hex prefix for solved keys. The default '00' is intentionally moderate for registrations.");
        CONFIG_PROPERTIES.add(property);
    }

    @Override
    public String getDisplayType() {
        return "ALTCHA";
    }

    @Override
    public String getReferenceCategory() {
        return "altcha";
    }

    @Override
    public boolean isConfigurable() {
        return true;
    }

    @Override
    public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
        return REQUIREMENT_CHOICES;
    }

    @Override
    public void buildPage(FormContext context, LoginFormsProvider form) {
        cleanupUsedNonces();

        String secret = hmacSecret(context.getAuthenticatorConfig());
        if (Validation.isBlank(secret)) {
            form.addError(new FormMessage(null, "altchaNotConfigured"));
            return;
        }

        try {
            String algorithm = configValue(context.getAuthenticatorConfig(), ALGORITHM, DEFAULT_ALGORITHM);
            int cost = intConfigValue(context.getAuthenticatorConfig(), COST, DEFAULT_COST);
            long expiresSeconds = longConfigValue(context.getAuthenticatorConfig(), EXPIRES_SECONDS, DEFAULT_EXPIRES_SECONDS);
            String keyPrefix = configValue(context.getAuthenticatorConfig(), KEY_PREFIX, DEFAULT_KEY_PREFIX);

            Altcha.Challenge challenge = Altcha.createChallenge(new Altcha.CreateChallengeOptions()
                    .algorithm(algorithm)
                    .cost(cost)
                    .expiresInSeconds(expiresSeconds)
                    .hmacSignatureSecret(secret)
                    .keyPrefix(keyPrefix)
                    .data(Map.of(
                            "realm", context.getRealm().getName(),
                            "action", "registration"
                    )));

            Locale locale = context.getSession().getContext().resolveLocale(context.getUser());
            form.setAttribute("altchaRequired", true);
            form.setAttribute("altchaChallengeJson", challenge.toJson());
            form.setAttribute("altchaLanguage", locale == null ? "de" : locale.getLanguage());
        } catch (Exception e) {
            logger.warn("Could not create ALTCHA challenge", e);
            form.addError(new FormMessage(null, "altchaNotConfigured"));
        }
    }

    @Override
    public void validate(ValidationContext context) {
        cleanupUsedNonces();

        MultivaluedMap<String, String> formData = context.getHttpRequest().getDecodedFormParameters();
        List<FormMessage> errors = new ArrayList<>();
        context.getEvent().detail(Details.REGISTER_METHOD, "form");

        String payload = formData.getFirst(ALTCHA_FIELD);
        if (Validation.isBlank(payload)) {
            reject(context, formData, errors);
            return;
        }

        String secret = hmacSecret(context.getAuthenticatorConfig());
        if (Validation.isBlank(secret)) {
            reject(context, formData, errors);
            return;
        }

        try {
            Altcha.Payload parsedPayload = Altcha.parsePayload(payload);
            Altcha.Challenge challenge = parsedPayload.challenge();
            String nonce = challenge.parameters().nonce();

            if (Validation.isBlank(nonce) || USED_NONCES.containsKey(nonce)) {
                reject(context, formData, errors);
                return;
            }

            Altcha.VerifySolutionResult result = Altcha.verifySolution(
                    payload,
                    secret,
                    Altcha.kdf(challenge.parameters().algorithm())
            );

            if (!result.verified()) {
                reject(context, formData, errors);
                return;
            }

            Long expiresAt = challenge.parameters().expiresAt();
            long cacheUntil = expiresAt == null ? (System.currentTimeMillis() / 1000L + DEFAULT_EXPIRES_SECONDS) : expiresAt;
            if (USED_NONCES.putIfAbsent(nonce, cacheUntil) != null) {
                reject(context, formData, errors);
                return;
            }

            formData.remove(ALTCHA_FIELD);
            context.success();
        } catch (Exception e) {
            logger.debug("ALTCHA validation failed", e);
            reject(context, formData, errors);
        }
    }

    private void reject(ValidationContext context, MultivaluedMap<String, String> formData, List<FormMessage> errors) {
        errors.add(new FormMessage(null, "altchaFailed"));
        formData.remove(ALTCHA_FIELD);
        context.error(Errors.INVALID_REGISTRATION);
        context.validationError(formData, errors);
        context.excludeOtherErrors();
    }

    private static String hmacSecret(AuthenticatorConfigModel config) {
        String fromConfig = configValue(config, HMAC_SECRET, "");
        if (!Validation.isBlank(fromConfig)) {
            return fromConfig;
        }
        return System.getenv(ENV_HMAC_SECRET);
    }

    private static String configValue(AuthenticatorConfigModel config, String key, String defaultValue) {
        if (config == null || config.getConfig() == null) {
            return defaultValue;
        }
        String value = config.getConfig().get(key);
        return Validation.isBlank(value) ? defaultValue : value;
    }

    private static int intConfigValue(AuthenticatorConfigModel config, String key, int defaultValue) {
        try {
            return Integer.parseInt(configValue(config, key, Integer.toString(defaultValue)));
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private static long longConfigValue(AuthenticatorConfigModel config, String key, long defaultValue) {
        try {
            return Long.parseLong(configValue(config, key, Long.toString(defaultValue)));
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private static void cleanupUsedNonces() {
        long now = System.currentTimeMillis() / 1000L;
        USED_NONCES.entrySet().removeIf(entry -> entry.getValue() <= now);
    }

    @Override
    public void success(FormContext context) {
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
    }

    @Override
    public boolean isUserSetupAllowed() {
        return false;
    }

    @Override
    public void close() {
    }

    @Override
    public FormAction create(KeycloakSession session) {
        return this;
    }

    @Override
    public void init(Config.Scope config) {
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getHelpText() {
        return "Adds ALTCHA proof-of-work bot protection to the registration form without external verification calls.";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return CONFIG_PROPERTIES;
    }
}
