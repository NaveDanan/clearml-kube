import versionConf from '../version.json';

export interface CommunityContext {
  title?: string;
  subtitle?: string;
  background?: string;
  backgroundPosition?: string;
  list?: { icon: string; title: string; text: string }[];
}

export interface GettingStartedContext {
  install?: string;
  configure?: string;
  packageName?: string;
}

export interface Legal {
  TOULink?: string;
  pricingLink?: string;
}

export interface InterfaceCustomizations {
  clonePrefix: string;
}

export interface SsoProvider {
  /** Stable identifier for the provider (e.g. "keycloak"). */
  name: string;
  /** Button label shown to the user. Falls back to `name`. */
  displayName?: string;
  /**
   * URL the browser is redirected to in order to start the SSO flow.
   * For the reverse-proxy (oauth2-proxy) setup this is the proxy sign-in
   * entrypoint, e.g. "/oauth2/start".
   */
  url: string;
  /** Optional ClearML icon class rendered before the label (e.g. "al-ico-lock"). */
  icon?: string;
}

export interface Environment {
  production: boolean;
  apiBaseUrl: string;
  fileBaseUrl: string;
  displayedServerUrls?: {apiServer?: string; filesServer?: string};
  productName: string;
  demo: boolean;
  headerPrefix: string;
  version: string;
  userKey: string;
  userSecret: string;
  companyID: string;
  loginNotice?: string;
  loginBanner?: string;
  autoLogin?: boolean;
  whiteLabelLogo?: boolean;
  whiteLabelLink?: any;
  whiteLabelLoginTitle?: string;
  whiteLabelLoginSubtitle?: string;
  whiteLabelSlogan?: string;
  communityServer?: boolean;
  enterpriseServer?: boolean;
  accountAdministration: boolean;
  communityContext?: CommunityContext;
  GTM_ID?: string;
  hideUpdateNotice: boolean;
  showSurvey: boolean;
  plotlyURL: string;
  slackLink: string;
  docsLink?: string;
  supportEmail?: string;
  useFilesProxy: boolean;
  branding?: {faviconUrl?: string; logo?: string; logoSmall?: string};
  gettingStartedContext?: GettingStartedContext;
  serverDownMessage?: string;
  legal: Legal;
  loginPopup?: string;
  platformYoutubeChannel: string;
  appsYouTubeIntroVideoId?: string;
  newExperimentYouTubeVideoId: string;
  baseHref?: string;
  loginFallback?: 'password-less' | 'error'; // defaults to 'password-less'
  displayTips: boolean;
  onlyPasswordLogin: boolean;
  blockUserScript?: boolean;
  forceTheme?: 'light' | 'dark';
  defaultTheme?: 'light' | 'dark';
  customStyle?: string;
  interfaceCustomization?: InterfaceCustomizations| undefined;
  /** Enables the native ClearPipe definition library and editor. Defaults to true. */
  clearpipeEnabled?: boolean;
  /**
   * External OIDC/SSO providers surfaced as "Log in with ..." buttons on the
   * login page. Delivered through configuration.json (see Helm auth.oidc).
   * When empty or omitted, no SSO button is shown.
   */
  ssoProviders?: SsoProvider[];
  /**
   * When true, the UI surfaces email-notification controls (e.g. "Email me when
   * this finishes"). Set from configuration.json; mirrors the apiserver SMTP
   * (apiserver.email.enabled) capability. Defaults to false.
   */
  emailNotificationsEnabled?: boolean;
}

export const BASE_ENV = {
  production: true,
  apiBaseUrl: null,
  fileBaseUrl: null,
  productName: 'clearml',
  demo: false,
  headerPrefix: 'X-Clearml',
  version: versionConf.version,
  userKey: 'EYVQ385RW7Y2QQUH88CZ7DWIQ1WUHP',
  userSecret: 'XhkH6a6ds9JBnM_MrahYyYdO-wS2bqFSm8gl-V0UZXH26Ydd6Eyi28TeBEoSr6Z3Bes',
  companyID: 'd1bd92a3b039400cbafc60a7a5b1e52b',
  loginNotice: '',
  loginBanner: '',
  autoLogin: false,
  whiteLabelLogo: null,
  whiteLabelLink: null,
  whiteLabelLoginTitle: null,
  whiteLabelLoginSubtitle: null,
  whiteLabelSlogan: null,
  communityContext: {
    background: 'app/webapp-common/assets/icons/human-polygon.svg'
  },
  GTM_ID: null,
  hideUpdateNotice: false,
  showSurvey: false,
  accountAdministration: false,
  useFilesProxy: true,
  legal: {TOULink: 'https://github.com/allegroai/clearml-server/blob/master/LICENSE'},
  plotlyURL: 'app/webapp-common/assets/plotly-2.35.0.min.js',
  slackLink: 'https://joinslack.clear.ml',
  docsLink: 'https://clear.ml/docs',
  supportEmail: 'support@clear.ml',
  branding: {logo: 'assets/logo-white.svg?v=7', logoSmall: 'assets/small-logo-white.svg?=2'},
  serverDownMessage: 'The ClearML server is currently unavailable.<BR>' +
    'Please try to reload this page in a little while.<BR>' +
    'If the problem persists, verify your network connection is working and check the ClearML server logs for possible errors',
  platformYoutubeChannel: 'https://www.youtube.com/c/ClearML/featured',
  newExperimentYouTubeVideoId: 's3k9ntmQmD4',
  displayTips: true,
  clearpipeEnabled: true,
} as Environment;

