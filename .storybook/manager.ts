import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

const lightTheme = create({
  base: 'light',
  brandTitle: 'Spoonjoy',
  brandUrl: 'https://spoonjoy.app',
  brandImage: '/logos/sj_black.svg',
  brandTarget: '_self',
});

const darkTheme = create({
  base: 'dark',
  brandTitle: 'Spoonjoy',
  brandUrl: 'https://spoonjoy.app',
  brandImage: '/logos/sj_white.svg',
  brandTarget: '_self',
});

addons.setConfig({
  theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? darkTheme : lightTheme,
});

// Inject CSS to constrain the sidebar logo size
const style = document.createElement('style');
style.textContent = `
  .sidebar-header img {
    max-width: 100px !important;
    max-height: 40px !important;
    width: auto !important;
    height: auto !important;
    object-fit: contain !important;
  }
`;
document.head.appendChild(style);
