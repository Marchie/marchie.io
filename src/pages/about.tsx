import React from 'react'
import Layout from '../components/layout'
import Head from '../components/head'
import {graphql} from 'gatsby'

interface Props {
  readonly data: PageQueryData
}

const About: React.FC<Props> = ({data}) => {
  const siteTitle = data.site.siteMetadata.title

  return (
    <Layout title={siteTitle}>
      <Head title={`About`} />
      <header>
        <h1>About</h1>
      </header>
      <article>
        <section>
          <p>
            My name is Chris March, I am a software engineer who lives in the city centre of Manchester, in the United
            Kingdom.
          </p>
        </section>
        <section>
          <p>
            This is my place to write about software development problems that I have found challenging and the
            solutions that I have implemented.
          </p>
        </section>
        <section>
          <p>
            You can find my personal blog at <a href="https://marchie.net">marchie.net</a>.
          </p>
        </section>
      </article>
    </Layout>
  )
}

interface PageQueryData {
  site: {
    siteMetadata: {
      title: string
    }
  }
}

export const pageQuery = graphql`
  query {
    site {
      siteMetadata {
        title
      }
    }
  }
`

export default About
