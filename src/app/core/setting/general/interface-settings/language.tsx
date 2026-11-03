'use client'

import { useEffect } from 'react'
import { usePluginResources } from '@/lib/plugins/resources'
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { getPluginLanguages, SUPPORTED_LOCALES } from '@/i18n/config'
import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Download, Languages } from 'lucide-react'
import { useI18n } from "@/hooks/useI18n"
import { ResponsiveSelect } from "@/components/responsive-select"
import { getLatestDesktopRelease } from '@/app/core/setting/plugins/plugin-display'

const DISCOVER_LANGUAGES = '__discover-language-plugins__'
const INSTALL_LANGUAGE_PREFIX = '__install-language-plugin__:'

export function LanguageSettings({ mobile = false }: { mobile?: boolean }) {
  usePluginResources(state => state.entries)
  const t = useTranslations('settings.general.interface')
  const pluginActions = useTranslations('settings.plugins.actions')
  const { currentLocale, changeLanguage } = useI18n()
  const openPluginDiscovery = useSettingsDialogStore(state => state.openPluginDiscovery)
  const openPluginInstall = useSettingsDialogStore(state => state.openPluginInstall)
  const catalog = usePluginStore(state => state.catalog)
  const installed = usePluginStore(state => state.installed)
  const refreshMarket = usePluginStore(state => state.refreshMarket)
  const appVersion = useSettingStore(state => state.version)
  const availableLanguages = getPluginLanguages()

  useEffect(() => {
    if (mobile) return
    const { catalog, marketLoading } = usePluginStore.getState()
    if (!marketLoading && (!catalog || catalog.stale)) void refreshMarket()
  }, [mobile, refreshMarket])

  const knownLocales = new Set([
    ...SUPPORTED_LOCALES,
    ...availableLanguages.map(language => language.value),
  ].map(locale => locale.toLowerCase()))
  const installedIds = new Set(installed.map(plugin => plugin.manifest.id))
  const marketLanguages: { name: string; pluginId: string }[] = []

  if (!mobile && catalog && !catalog.stale) {
    // Official language packs encode their BCP 47 locale in the plugin ID.
    const plugins = [...catalog.plugins].sort((left, right) => (
      Number(Boolean(right.official)) - Number(Boolean(left.official))
      || left.id.localeCompare(right.id)
    ))
    for (const plugin of plugins) {
      if (!plugin.categories?.includes('language') || installedIds.has(plugin.id)) continue
      if (!getLatestDesktopRelease(plugin, appVersion)) continue
      const localeSlug = plugin.id.match(/(?:^|\.)language-pack-([a-z0-9-]+)$/i)?.[1]
      if (!localeSlug) continue
      try {
        const [locale] = Intl.getCanonicalLocales(localeSlug)
        if (knownLocales.has(locale.toLowerCase())) continue
        const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(locale)
        if (!name) continue
        knownLocales.add(locale.toLowerCase())
        marketLanguages.push({ name, pluginId: plugin.id })
      } catch {
        // A malformed or unsupported locale must not break available languages.
        continue
      }
    }
    marketLanguages.sort((left, right) => left.name.localeCompare(right.name))
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Languages /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('language.title')}</ItemTitle>
        <ItemDescription>{t('language.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ResponsiveSelect
          title={t('language.title')}
          value={currentLocale}
          onValueChange={(value) => {
            if (value === DISCOVER_LANGUAGES) {
              openPluginDiscovery('language')
              return
            }
            if (value.startsWith(INSTALL_LANGUAGE_PREFIX)) {
              openPluginInstall(value.slice(INSTALL_LANGUAGE_PREFIX.length))
              return
            }
            void changeLanguage(value)
          }}
          className="w-full sm:w-[180px]"
          options={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
            ...availableLanguages.filter(x => !(SUPPORTED_LOCALES as readonly string[]).includes(x.value)),
            ...marketLanguages.map(language => ({
              value: `${INSTALL_LANGUAGE_PREFIX}${language.pluginId}`,
              label: (
                <span className="flex items-center gap-2">
                  <span>{language.name}</span>
                  <Download aria-hidden="true" />
                  <span className="sr-only">{pluginActions('install')}</span>
                </span>
              ),
            })),
            ...(!mobile ? [{ value: DISCOVER_LANGUAGES, label: t('language.findInPlugins') }] : []),
          ]}
        />
      </ItemActions>
    </Item>
  )
}
